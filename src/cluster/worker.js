/**
 * Worker Process
 * 
 * Runs the actual HTTP server.
 * Communicates with master for:
 * - Heartbeats (every 5 seconds)
 * - Drain signals (graceful shutdown)
 * - Crash monitoring
 * 
 * Key behaviors:
 * - Sends health metrics to master periodically
 * - Stops accepting connections when told to drain
 * - Waits for existing connections before exiting
 */

import cluster from 'cluster';
import os from 'os';
import express from 'express';
import { createStaticServer } from './static-server.js';
import { createAdminPanel } from '../panels/admin.js';
import { createMaintenancePanel } from '../panels/maintenance.js';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { getMaintenanceManager } from '../maintenance/manager.js';

/**
 * Create and run worker HTTP server
 */
export function createWorker(watchdog) {
  const app = express();
  const workerId = cluster.worker.id;
  
  // Track connection count for graceful shutdown
  let activeConnections = new Set();
  let isDraining = false;
  let lastHeartbeat = Date.now();
  let requestCount = 0;
  let errorCount = 0;

  logger.info(`Worker ${workerId} starting`, {
    pid: process.pid,
    staticDir: config.staticSiteDir,
  });

  /**
   * Calculate event loop lag for health reporting
   */
  function measureEventLoopLag() {
    const start = Date.now();
    setImmediate(() => {
      const lag = Date.now() - start;
      return lag;
    });
  }

  /**
   * Send heartbeat to master with health metrics
   */
  function sendHeartbeat() {
    try {
      const memUsage = process.memoryUsage();
      const health = {
        workerId,
        memoryUsageMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        eventLoopLagMs: 0, // Simplified for this implementation
        errorCount,
        requestCount,
        uptime: process.uptime(),
      };

      // Send heartbeat to master
      process.send({
        type: 'heartbeat',
        data: health,
      });

      lastHeartbeat = Date.now();
    } catch (err) {
      logger.error('Error sending heartbeat', {
        error: err.message,
        workerId,
      });
    }
  }

  /**
   * Middleware: Track connections
   */
  app.use((req, res, next) => {
    // Don't accept new connections if draining
    if (isDraining) {
      res.setHeader('Connection', 'close');
      return res.status(503).json({
        error: 'Server shutting down',
      });
    }

    // Track connection
    const connId = Math.random().toString(36);
    activeConnections.add(connId);

    res.on('finish', () => {
      activeConnections.delete(connId);
    });

    res.on('close', () => {
      activeConnections.delete(connId);
    });

    next();
  });

  /**
   * Middleware: Track requests
   */
  app.use((req, res, next) => {
    requestCount++;
    const startTime = Date.now();

    const originalJson = res.json;
    const originalSend = res.send;

    // Wrap json response
    res.json = function (data) {
      if (res.statusCode >= 400) {
        errorCount++;
      }
      return originalJson.call(this, data);
    };

    // Wrap send response
    res.send = function (data) {
      if (res.statusCode >= 400) {
        errorCount++;
      }
      return originalSend.call(this, data);
    };

    res.on('finish', () => {
      const duration = Date.now() - startTime;
      logger.debug('HTTP request completed', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
      });
    });

    next();
  });

  /**
   * Middleware: Maintenance mode check
   */
  app.use((req, res, next) => {
    const maintenance = getMaintenanceManager();

    // Check if route should bypass maintenance
    if (maintenance.shouldBypassMaintenance(req.path)) {
      return next();
    }

    // Check if maintenance is enabled
    if (maintenance.getState().enabled) {
      // Serve maintenance page
      res.status(503);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(maintenance.getMaintenancePage());
    }

    next();
  });

  /**
   * Internal health endpoints (not public)
   * Accessible via admin/maintenance panels
   */
  app.get('/internal/health', (req, res) => {
    res.json({
      status: 'healthy',
      workerId,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      requests: requestCount,
      errors: errorCount,
    });
  });

  /**
   * Admin panel routes
   */
  app.use('/admin', createAdminPanel(watchdog));

  /**
   * Maintenance panel routes (ops only)
   */
  app.use('/maintenance', createMaintenancePanel(cluster, watchdog));

  /**
   * Static file server
   */
  app.use('/', createStaticServer());

  /**
   * 404 handler
   */
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not found',
      path: req.path,
    });
  });

  /**
   * Error handler
   */
  app.use((err, req, res, next) => {
    errorCount++;
    logger.error('Express error', {
      path: req.path,
      method: req.method,
      error: err.message,
      stack: err.stack,
    });

    res.status(500).json({
      error: 'Internal server error',
    });
  });

  /**
   * Handle drain signal from master
   */
  process.on('message', async (msg) => {
    if (msg.cmd === 'drain') {
      logger.info('Received drain signal', { workerId });
      isDraining = true;

      // Close server to stop accepting new connections
      if (server) {
        server.close(() => {
          logger.info('Server closed to new connections', { workerId });
        });
      }

      // Wait for active connections to finish (with timeout)
      const drainStart = Date.now();
      const drainCheckInterval = setInterval(() => {
        if (activeConnections.size === 0) {
          clearInterval(drainCheckInterval);
          logger.info('All connections drained, exiting', { workerId });
          process.exit(0);
        }

        const elapsed = Date.now() - drainStart;
        if (elapsed > config.cluster.drainTimeoutMs) {
          clearInterval(drainCheckInterval);
          logger.warn('Drain timeout exceeded, force exiting', {
            workerId,
            elapsedMs: elapsed,
            activeConnections: activeConnections.size,
          });
          process.exit(0);
        }
      }, 100);
    }
  });

  /**
   * Handle process shutdown signals
   */
  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, starting graceful shutdown', { workerId });
    isDraining = true;

    if (server) {
      server.close(() => {
        logger.info('Server closed, exiting gracefully', { workerId });
        process.exit(0);
      });
    }
  });

  /**
   * Start the server
   */
  const server = app.listen(config.port, () => {
    logger.info(`Worker ${workerId} listening`, {
      port: config.port,
      address: `http://localhost:${config.port}`,
    });
  });

  server.on('error', (err) => {
    errorCount++;
    logger.error('Server error', {
      workerId,
      error: err.message,
    });
  });

  /**
   * Start sending heartbeats to master
   */
  const heartbeatInterval = setInterval(() => {
    sendHeartbeat();
  }, config.cluster.heartbeatIntervalMs);

  /**
   * Graceful shutdown on worker error
   */
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception in worker', {
      workerId,
      error: err.message,
      stack: err.stack,
    });

    // Send error to master and exit
    try {
      process.send({
        type: 'crash',
        error: err.message,
      });
    } catch (e) {
      // Ignore if master process doesn't exist
    }

    // Exit with error code
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  return {
    server,
    cleanup: () => {
      clearInterval(heartbeatInterval);
    },
  };
}
