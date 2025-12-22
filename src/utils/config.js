/**
 * Configuration Management
 * 
 * Handles environment variables and configuration with sensible defaults.
 * Ensures all critical configuration is validated at startup.
 * Production-grade configuration defaults prevent unsafe behavior.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '../../');

/**
 * Configuration object with production defaults
 * All values are validated and sanitized
 */
const config = {
  // Server Configuration
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'production',
  staticSiteDir: path.resolve(process.env.STATIC_SITE_DIR || path.join(ROOT_DIR, 'website')),
  
  // Authentication
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'changeme123',
  },
  // Ops (maintenance panel) credentials
  maintenanceAuth: {
    username: process.env.MAINTENANCE_USERNAME || 'ops',
    password: process.env.MAINTENANCE_PASSWORD || 'changeme456',
  },
  auth: {
    sessionSecret: process.env.SESSION_SECRET || '',
  },

  // Email/Alerts via Resend
  email: {
    apiKey: process.env.RESEND_API_KEY || '',
    adminEmail: process.env.ADMIN_EMAIL || 'admin@example.com',
    alertEmails: (process.env.ALERT_EMAILS || 'admin@example.com').split(',').map(e => e.trim()),
  },

  // Cluster Configuration
  cluster: {
    // Number of worker processes (defaults to CPU count / 2, min 2, max 8 for stability)
    workerCount: Math.min(8, Math.max(2, parseInt(process.env.WORKER_COUNT || '0', 10) || Math.ceil(os.cpus().length / 2))),
    
    // Memory threshold per worker before marking unhealthy (MB)
    memoryThresholdMB: parseInt(process.env.MEMORY_THRESHOLD_MB || '256', 10),
    
    // Heartbeat configuration - workers send periodic signals to master
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '5000', 10),
    heartbeatTimeoutMs: parseInt(process.env.HEARTBEAT_TIMEOUT_MS || '15000', 10),
    
    // Crash loop detection: if worker restarts more than threshold times in window, stop restarting
    restartThreshold: parseInt(process.env.RESTART_THRESHOLD || '5', 10),
    restartWindowMs: parseInt(process.env.RESTART_WINDOW_MS || '60000', 10),
    
    // Graceful shutdown timeout before force kill
    gracefulShutdownTimeoutMs: 30000,
    
    // Drain timeout: maximum time to wait for existing connections before forcing shutdown
    drainTimeoutMs: 10000,
  },

  // Maintenance & Persistence
  maintenance: {
    pageDir: path.resolve(process.env.MAINTENANCE_PAGE_DIR || path.join(ROOT_DIR, 'maintenance')),
    stateFile: path.resolve(process.env.MAINTENANCE_FILE || path.join(ROOT_DIR, 'data', 'maintenance-state.json')),
  },

  // Filesystem Watchers
  watchers: {
    // Debounce time for file changes to avoid redundant reloads during atomic writes
    debounceMs: 300,
    // Ignored patterns
    ignored: ['node_modules', '.git', '*.swp', '*.swo', '*~', '.DS_Store'],
  },

  // Logging
  logging: {
    logDir: path.resolve(process.env.LOG_DIR || path.join(ROOT_DIR, 'logs')),
    // Max log file size before rotation (10MB)
    maxFileSizeBytes: 10 * 1024 * 1024,
    // Keep logs for 7 days
    retentionDays: 7,
  },

  // Data Directory for persistence
  dataDir: path.resolve(path.join(ROOT_DIR, 'data')),

  // Paths
  paths: {
    root: ROOT_DIR,
    src: path.join(ROOT_DIR, 'src'),
    data: path.join(ROOT_DIR, 'data'),
    logs: path.resolve(process.env.LOG_DIR || path.join(ROOT_DIR, 'logs')),
  },
};

/**
 * Validate and initialize configuration
 * Ensures all required directories exist
 */
function initializeConfig() {
  // Create required directories if they don't exist
  const requiredDirs = [
    config.paths.data,
    config.paths.logs,
    config.maintenance.pageDir,
  ];

  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Ensure a stable session secret for stateless auth across workers
  if (!config.auth.sessionSecret) {
    const secretFile = path.join(config.dataDir, 'session-secret');
    try {
      if (fs.existsSync(secretFile)) {
        const s = fs.readFileSync(secretFile, 'utf8').trim();
        if (s) config.auth.sessionSecret = s;
      } else {
        const random = Buffer.from(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))).toString('hex');
        fs.writeFileSync(secretFile, random, 'utf8');
        config.auth.sessionSecret = random;
      }
    } catch (e) {
      // Fallback to ephemeral secret if disk unavailable
      if (!config.auth.sessionSecret) {
        config.auth.sessionSecret = Math.random().toString(36).slice(2) + Date.now().toString(36);
      }
    }
  }

  // Validate critical settings
  if (config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid PORT: ${config.port}. Must be between 1 and 65535`);
  }

  if (config.cluster.workerCount < 1) {
    throw new Error(`Invalid WORKER_COUNT: ${config.cluster.workerCount}. Must be at least 1`);
  }

  if (!fs.existsSync(config.staticSiteDir)) {
    console.warn(`⚠️  STATIC_SITE_DIR does not exist: ${config.staticSiteDir}`);
    console.warn(`   Creating directory...`);
    fs.mkdirSync(config.staticSiteDir, { recursive: true });
  }

  return config;
}

export default initializeConfig();
