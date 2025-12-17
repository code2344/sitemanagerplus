#!/usr/bin/env node

/**
 * SiteManager+ - Production-Grade Static Website Server
 * 
 * Ultra fault-tolerant Node.js server runtime with:
 * - Multi-worker cluster with automatic recovery
 * - Graceful rolling restarts (zero downtime)
 * - Watchdog monitoring and self-healing
 * - Persistent maintenance mode
 * - Admin and ops control panels
 * - Email alerts via Resend
 * - Filesystem hot-reload
 * 
 * Entry point for the application
 */

import cluster from 'cluster';
import os from 'os';
import { createMaster } from './cluster/master.js';
import { createWorker } from './cluster/worker.js';
import { Watchdog } from './watchdog/coordinator.js';
import config from './utils/config.js';
import logger from './utils/logger.js';

/**
 * Main entry point
 */
async function main() {
  try {
    if (cluster.isPrimary) {
      // Master process
      logger.info('🚀 SiteManager+ Starting (Master)', {
        version: '1.0.0',
        platform: process.platform,
        nodeVersion: process.version,
        cpuCount: os.cpus().length,
      });

      const master = createMaster();

      // Keep master running
      process.on('exit', (code) => {
        logger.info('Master process exiting', { code });
      });

    } else {
      // Worker process
      const watchdog = new Watchdog(cluster, { cluster });
      createWorker(watchdog);
    }
  } catch (err) {
    logger.error('Fatal error in main', {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }
}

// Start the application
main();
