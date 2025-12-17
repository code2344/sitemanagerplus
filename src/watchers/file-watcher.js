/**
 * Filesystem Watchers & Hot Reload
 * 
 * Monitors for changes in:
 * - Static site files (reload without restart)
 * - Configuration files (trigger rolling restart)
 * - Maintenance page (reload instantly)
 * 
 * Uses debouncing to handle atomic writes and partial saves
 */

import chokidar from 'chokidar';
import path from 'path';
import logger from '../utils/logger.js';
import config from '../utils/config.js';
import { getMaintenanceManager } from '../maintenance/manager.js';

/**
 * File change debouncer
 * Prevents multiple triggers for single file changes
 */
class Debouncer {
  constructor(delayMs = 300) {
    this.delayMs = delayMs;
    this.timers = new Map();
  }

  /**
   * Debounce a function call
   */
  debounce(key, fn) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    const timer = setTimeout(() => {
      fn();
      this.timers.delete(key);
    }, this.delayMs);

    this.timers.set(key, timer);
  }

  /**
   * Cleanup all timers
   */
  destroy() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

/**
 * Watch static site directory for changes
 * Reloads content without restarting workers
 */
export function watchStaticSite(onContentChanged) {
  const debouncer = new Debouncer(config.watchers.debounceMs);
  let isReady = false;

  const watcher = chokidar.watch(config.staticSiteDir, {
    ignored: config.watchers.ignored,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  });

  watcher
    .on('ready', () => {
      isReady = true;
      logger.info('Static site watcher ready', {
        directory: config.staticSiteDir,
      });
    })
    .on('add', (filepath) => {
      if (!isReady) return; // Ignore initial discovery
      
      logger.debug('Static file added', { path: filepath });
      debouncer.debounce('content-change', () => {
        logger.info('Static content changed (add)', { path: filepath });
        onContentChanged?.('add', filepath);
      });
    })
    .on('change', (filepath) => {
      if (!isReady) return;

      logger.debug('Static file changed', { path: filepath });
      debouncer.debounce('content-change', () => {
        logger.info('Static content changed (modify)', { path: filepath });
        onContentChanged?.('change', filepath);
      });
    })
    .on('unlink', (filepath) => {
      if (!isReady) return;

      logger.info('Static file deleted', { path: filepath });
      onContentChanged?.('unlink', filepath);
    })
    .on('error', (err) => {
      logger.error('Static site watcher error', {
        error: err.message,
      });
    });

  return {
    watcher,
    destroy: () => {
      debouncer.destroy();
      return watcher.close();
    },
  };
}

/**
 * Watch maintenance page for changes
 * Reloads instantly without any restart
 */
export function watchMaintenancePage() {
  const debouncer = new Debouncer(config.watchers.debounceMs);
  let isReady = false;

  const watcher = chokidar.watch(config.maintenance.pageDir, {
    ignored: config.watchers.ignored,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  });

  const maintenance = getMaintenanceManager();

  watcher
    .on('ready', () => {
      isReady = true;
      logger.info('Maintenance page watcher ready', {
        directory: config.maintenance.pageDir,
      });
    })
    .on('change', (filepath) => {
      if (!isReady) return;
      if (!filepath.includes('maintenance.html')) return;

      logger.info('Maintenance page file changed', { path: filepath });
      debouncer.debounce('maintenance-page', () => {
        logger.info('Reloading maintenance page from disk');
        maintenance.reloadMaintenancePage();
      });
    })
    .on('error', (err) => {
      logger.error('Maintenance page watcher error', {
        error: err.message,
      });
    });

  return {
    watcher,
    destroy: () => {
      debouncer.destroy();
      return watcher.close();
    },
  };
}

/**
 * Watch configuration files for changes
 * Triggers graceful rolling restart on change
 */
export function watchConfig(onConfigChanged) {
  const debouncer = new Debouncer(config.watchers.debounceMs);
  let isReady = false;

  const filesToWatch = [
    path.join(config.paths.root, '.env'),
  ];

  const watcher = chokidar.watch(filesToWatch, {
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  });

  watcher
    .on('ready', () => {
      isReady = true;
      logger.info('Config file watcher ready');
    })
    .on('change', (filepath) => {
      if (!isReady) return;

      logger.warn('Configuration file changed', { path: filepath });
      debouncer.debounce('config-change', () => {
        logger.warn('Triggering rolling restart due to config change');
        onConfigChanged?.('change', filepath);
      });
    })
    .on('error', (err) => {
      logger.error('Config watcher error', {
        error: err.message,
      });
    });

  return {
    watcher,
    destroy: () => {
      debouncer.destroy();
      return watcher.close();
    },
  };
}
