/**
 * Master Process (Cluster Controller)
 * 
 * Responsible for:
 * - Managing worker processes
 * - Implementing the watchdog
 * - Coordinating graceful rolling restarts
 * - Monitoring system health
 * - Handling file watcher callbacks
 * 
 * The master never handles HTTP requests, only system management.
 */

import cluster from 'cluster';
import os from 'os';
import tty from 'tty';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { Watchdog } from '../watchdog/coordinator.js';
import { getMaintenanceManager } from '../maintenance/manager.js';
import { createWorker } from './worker.js';
import { InteractiveCLI } from '../cli/interactive.js';
import {
  watchStaticSite,
  watchMaintenancePage,
  watchConfig,
} from '../watchers/file-watcher.js';

/**
 * Master process controller
 */
export async function createMaster() {
  logger.info('Master process starting', {
    pid: process.pid,
    nodeEnv: config.nodeEnv,
    workerCount: config.cluster.workerCount,
  });

  // Initialize maintenance manager (loads state from disk)
  const maintenance = getMaintenanceManager();
  logger.info('Maintenance state loaded', {
    enabled: maintenance.getState().enabled,
  });

  // Create watchdog
  const watchdog = new Watchdog(cluster, { cluster });
  watchdog.start();

  // Store for later reference
  const watchers = [];

  /**
   * Spawn initial workers
   */
  function spawnWorkers() {
    const count = config.cluster.workerCount;
    logger.info(`Spawning ${count} workers...`);

    for (let i = 0; i < count; i++) {
      const worker = cluster.fork();
      watchdog.healthMonitor.registerWorker(worker.id);
      logger.info('Worker spawned', { workerId: worker.id, pid: worker.process.pid });
    }
  }

  /**
   * Handle worker messages (heartbeats, etc)
   */
  cluster.on('message', (worker, message) => {
    if (message.type === 'heartbeat') {
      watchdog.recordHeartbeat(worker.id, message.data);
    } else if (message.type === 'crash') {
      logger.error('Worker reported crash', {
        workerId: worker.id,
        error: message.error,
      });
    }
  });

  /**
   * Handle worker exit
   */
  cluster.on('exit', (worker, code, signal) => {
    watchdog.healthMonitor.removeWorker(worker.id);
  });

  /**
   * Setup file watchers
   */
  function setupWatchers() {
    logger.info('Setting up file watchers...');

    // Watch static files
    const staticWatcher = watchStaticSite((action, filepath) => {
      logger.info('Static content changed, updating cache', {
        action,
        file: filepath,
      });
      // In production, notify workers about cache invalidation
      // For now, files are served fresh on each request
    });
    watchers.push(staticWatcher);

    // Watch maintenance page
    const maintenanceWatcher = watchMaintenancePage();
    watchers.push(maintenanceWatcher);

    // Watch config files
    const configWatcher = watchConfig((action, filepath) => {
      logger.warn('Configuration file changed, triggering rolling restart', {
        file: filepath,
      });
      watchdog.gracefulRollingRestart('Configuration file updated');
    });
    watchers.push(configWatcher);

    logger.info('File watchers ready');
  }

  /**
   * Setup interactive CLI
   * Runs in master process alongside HTTP server
   */
  async function setupInteractiveCLI() {
    // Only setup CLI if we have a TTY (interactive terminal)
    if (!tty.isatty(process.stdin.fd) && process.argv[2] !== '--cli') {
      logger.debug('No TTY detected, skipping interactive CLI');
      return;
    }

    try {
      const cli = new InteractiveCLI(watchdog, {
        autoClose: false,
      });

      // Start CLI in background (runs concurrently with HTTP server)
      cli.start().catch(err => {
        logger.error('CLI error', { error: err.message });
      });

      logger.info('Interactive CLI initialized');
    } catch (err) {
      logger.warn('Failed to initialize interactive CLI', { error: err.message });
    }
  }

  /**
   * Graceful shutdown of master
   */
  async function gracefulShutdown(signal) {
    logger.info(`Master received ${signal}, shutting down gracefully...`);

    // Stop watchdog
    watchdog.stop();

    // Close all watchers
    for (const watcher of watchers) {
      try {
        await watcher.destroy();
      } catch (err) {
        logger.error('Error closing watcher', { error: err.message });
      }
    }

    // Gracefully shut down all workers
    const shutdownTimeout = setTimeout(() => {
      logger.warn('Graceful shutdown timeout exceeded, force exiting');
      process.exit(0);
    }, config.cluster.gracefulShutdownTimeoutMs);

    // Disconnect from workers (they will not receive new work)
    cluster.disconnect(() => {
      clearTimeout(shutdownTimeout);
      logger.info('All workers disconnected, exiting');
      process.exit(0);
    });
  }

  /**
   * Handle master process signals
   */
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  /**
   * Handle uncaught exceptions in master
   */
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception in master', {
      error: err.message,
      stack: err.stack,
    });
    gracefulShutdown('uncaughtException');
  });

  /**
   * Setup unhandled promise rejections
   */
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', {
      reason: String(reason),
      promise: String(promise),
    });
  });

  /**
   * Initial startup
   */
  logger.info('Master initialization complete', {
    pid: process.pid,
    staticDir: config.staticSiteDir,
    port: config.port,
  });

  // Initialize interactive CLI before spawning workers so logs are redirected
  await setupInteractiveCLI();
  spawnWorkers();
  setupWatchers();

  logger.info('SiteManager+ started successfully', {
    timestamp: new Date().toISOString(),
    url: `http://localhost:${config.port}`,
  });

  return {
    watchdog,
    cluster,
    shutdown: gracefulShutdown,
  };
}
