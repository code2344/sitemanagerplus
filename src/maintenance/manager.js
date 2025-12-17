/**
 * Maintenance Mode System
 * 
 * Persistent maintenance state management.
 * 
 * Key features:
 * - Maintenance state persisted to disk
 * - All public traffic redirected to maintenance page
 * - /admin and /maintenance routes always bypass maintenance
 * - Can be triggered automatically or manually
 * - Instant on/off without restart
 * 
 * Maintenance state stored as JSON file for persistence across restarts.
 */

import fs from 'fs';
import path from 'path';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { EventEmitter } from 'events';

/**
 * Maintenance state structure
 */
const DEFAULT_MAINTENANCE_STATE = {
  enabled: false,
  reason: '',
  startedAt: null,
  expectedDurationMinutes: null,
  triggeredBy: 'system', // 'admin' or 'system' or 'watchdog'
  autoDisableAt: null,
};

/**
 * MaintenanceManager handles all maintenance mode operations
 */
export class MaintenanceManager extends EventEmitter {
  constructor() {
    super();
    this.stateFile = config.maintenance.stateFile;
    this.state = { ...DEFAULT_MAINTENANCE_STATE };
    this.maintenancePageCache = null;
    this.loadState();
    this.loadMaintenancePage();
  }

  /**
   * Load maintenance state from disk
   * Gracefully handles missing or corrupted files
   */
  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = fs.readFileSync(this.stateFile, 'utf8');
        const loaded = JSON.parse(data);
        // Merge with defaults to handle schema changes
        this.state = { ...DEFAULT_MAINTENANCE_STATE, ...loaded };
        logger.info('Maintenance state loaded from disk', {
          enabled: this.state.enabled,
          reason: this.state.reason,
        });
      } else {
        this.state = { ...DEFAULT_MAINTENANCE_STATE };
        logger.info('No maintenance state file found, using defaults');
      }
    } catch (err) {
      logger.error('Failed to load maintenance state, using defaults', {
        error: err.message,
      });
      this.state = { ...DEFAULT_MAINTENANCE_STATE };
    }
  }

  /**
   * Save maintenance state to disk
   * Never crashes even if write fails
   */
  saveState() {
    try {
      const dir = path.dirname(this.stateFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      logger.error('Failed to save maintenance state', {
        error: err.message,
      });
      // Continue anyway - maintenance mode is still active in memory
    }
  }

  /**
   * Load maintenance page from disk or use fallback
   */
  loadMaintenancePage() {
    try {
      const pageDir = config.maintenance.pageDir;
      const pagePath = path.join(pageDir, 'maintenance.html');
      
      if (fs.existsSync(pagePath)) {
        this.maintenancePageCache = fs.readFileSync(pagePath, 'utf8');
        logger.debug('Maintenance page loaded from disk');
      } else {
        this.maintenancePageCache = this.getDefaultMaintenancePage();
        logger.info('Using default maintenance page');
      }
    } catch (err) {
      logger.error('Failed to load maintenance page', { error: err.message });
      this.maintenancePageCache = this.getDefaultMaintenancePage();
    }
  }

  /**
   * Default maintenance page if custom one not found
   */
  getDefaultMaintenancePage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Maintenance Mode</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            text-align: center;
            background: white;
            padding: 3rem;
            border-radius: 10px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 500px;
        }
        h1 { color: #333; margin: 0 0 1rem 0; }
        p { color: #666; margin: 1rem 0; line-height: 1.6; }
        .icon { font-size: 3rem; margin-bottom: 1rem; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">🔧</div>
        <h1>Maintenance in Progress</h1>
        <p>We're currently performing scheduled maintenance to improve your experience.</p>
        <p>We'll be back online shortly. Thank you for your patience!</p>
    </div>
</body>
</html>`;
  }

  /**
   * Enable maintenance mode
   */
  enable(reason = '', durationMinutes = null, triggeredBy = 'admin') {
    const wasEnabled = this.state.enabled;
    
    this.state.enabled = true;
    this.state.reason = reason;
    this.state.startedAt = new Date().toISOString();
    this.state.expectedDurationMinutes = durationMinutes;
    this.state.triggeredBy = triggeredBy;
    this.state.autoDisableAt = durationMinutes
      ? new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
      : null;

    this.saveState();

    logger.warn('Maintenance mode enabled', {
      reason,
      duration: durationMinutes ? `${durationMinutes} minutes` : 'indefinite',
      triggeredBy,
    });

    if (!wasEnabled) {
      this.emit('enabled', this.state);
    }
  }

  /**
   * Disable maintenance mode
   */
  disable() {
    const wasEnabled = this.state.enabled;
    
    this.state.enabled = false;
    this.state.reason = '';
    this.state.startedAt = null;
    this.state.expectedDurationMinutes = null;
    this.state.autoDisableAt = null;

    this.saveState();

    logger.info('Maintenance mode disabled');

    if (wasEnabled) {
      this.emit('disabled', this.state);
    }
  }

  /**
   * Toggle maintenance mode
   */
  toggle(reason = '', durationMinutes = null) {
    if (this.state.enabled) {
      this.disable();
    } else {
      this.enable(reason, durationMinutes, 'admin');
    }
  }

  /**
   * Check if we should auto-disable maintenance
   */
  checkAutoDisable() {
    if (this.state.enabled && this.state.autoDisableAt) {
      if (new Date() >= new Date(this.state.autoDisableAt)) {
        logger.info('Auto-disabling maintenance mode (duration expired)');
        this.disable();
      }
    }
  }

  /**
   * Get current maintenance state
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Check if route should bypass maintenance mode
   */
  shouldBypassMaintenance(pathname) {
    // Admin and maintenance routes always bypass
    return pathname.startsWith('/admin') || pathname.startsWith('/maintenance');
  }

  /**
   * Get maintenance page HTML
   */
  getMaintenancePage() {
    return this.maintenancePageCache;
  }

  /**
   * Check if maintenance page is available
   */
  isMaintenancePageReady() {
    return !!this.maintenancePageCache;
  }

  /**
   * Reload maintenance page from disk
   * Called when file watchers detect changes
   */
  reloadMaintenancePage() {
    logger.info('Reloading maintenance page...');
    this.loadMaintenancePage();
  }
}

// Singleton instance
let maintenanceManager = null;

/**
 * Get or create the maintenance manager singleton
 */
export function getMaintenanceManager() {
  if (!maintenanceManager) {
    maintenanceManager = new MaintenanceManager();
  }
  return maintenanceManager;
}
