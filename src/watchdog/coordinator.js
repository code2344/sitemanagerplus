/**
 * Watchdog System
 * 
 * Critical component that monitors and manages worker health:
 * - Detects crashed workers
 * - Detects hung workers (heartbeat timeout)
 * - Monitors memory usage
 * - Prevents crash loops
 * - Triggers maintenance mode if health is critical
 * - Coordinates graceful rolling restarts
 * 
 * The watchdog is the master process's primary defense mechanism
 * against any worker failure scenario.
 */

import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { HEALTH_STATUS, HealthMonitor } from '../health/monitor.js';
import { getMaintenanceManager } from '../maintenance/manager.js';
import * as emailAlerts from '../email/alerts.js';

/**
 * Watchdog coordinator
 * Runs in master process and monitors all workers
 */
export class Watchdog {
  constructor(clusterModule, master) {
    this.cluster = clusterModule;
    this.master = master;
    this.healthMonitor = new HealthMonitor();
    
    // Track worker restart attempts for crash loop detection
    this.workerRestarts = new Map(); // workerId -> [timestamps...]
    
    // Track if we're in a controlled restart sequence
    this.isRollingRestart = false;
    this.rollingRestartQueue = [];
    
    // Check interval - verify worker health every 2 seconds
    this.checkInterval = null;
    this.checkIntervalMs = 2000;
  }

  /**
   * Start the watchdog monitoring
   */
  start() {
    logger.info('Watchdog started', {
      checkIntervalMs: this.checkIntervalMs,
      memoryThresholdMB: config.cluster.memoryThresholdMB,
      heartbeatTimeoutMs: config.cluster.heartbeatTimeoutMs,
    });

    // Register for worker events
    this.cluster.on('exit', (worker, code, signal) => {
      this.onWorkerExit(worker, code, signal);
    });

    // Start periodic health checks
    this.checkInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.checkIntervalMs);
  }

  /**
   * Stop the watchdog
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    logger.info('Watchdog stopped');
  }

  /**
   * Record a worker's heartbeat
   */
  recordHeartbeat(workerId, healthData) {
    this.healthMonitor.registerWorker(workerId);
    this.healthMonitor.processHeartbeat(workerId, healthData);
  }

  /**
   * Called when a worker process exits
   */
  onWorkerExit(worker, code, signal) {
    const workerId = worker.id;
    const exitReason = signal ? `signal ${signal}` : `code ${code}`;
    
    logger.warn('Worker exited', {
      workerId,
      exitReason,
    });

    // Check if this is a crash loop
    if (!this.shouldRestartWorker(workerId)) {
      logger.error('Worker restart prevented: crash loop detected', {
        workerId,
        restarts: this.workerRestarts.get(workerId)?.length || 0,
      });
      
      // Alert admin about crash loop
      emailAlerts.alertCrashLoopDetected(
        workerId,
        this.workerRestarts.get(workerId)?.length || 0,
        Math.round(config.cluster.restartWindowMs / 60000)
      );

      return; // Don't restart
    }

    // Record the restart attempt
    this.recordWorkerRestart(workerId);

    // Check system health and possibly enter maintenance mode
    const systemHealth = this.healthMonitor.getSystemHealth();
    if (systemHealth === HEALTH_STATUS.UNHEALTHY) {
      logger.warn('System health is unhealthy, entering maintenance mode', {
        workerId,
      });
      getMaintenanceManager().enable(
        `Worker ${workerId} crashed and system health is critical`,
        null,
        'watchdog'
      );
      emailAlerts.alertWatchdogIntervention('Maintenance activated', {
        reason: 'System health unhealthy after worker crash',
        workerId,
      });
    }

    // Spawn replacement worker if not already doing so
    if (!this.isRollingRestart) {
      logger.info('Spawning replacement worker', { workerId });
      this.cluster.fork();
    }
  }

  /**
   * Check if we should restart a worker or if it's a crash loop
   */
  shouldRestartWorker(workerId) {
    const restarts = this.workerRestarts.get(workerId) || [];
    const now = Date.now();
    
    // Remove old restart attempts outside the window
    const recentRestarts = restarts.filter(
      timestamp => (now - timestamp) < config.cluster.restartWindowMs
    );

    // If too many restarts in the window, don't restart
    if (recentRestarts.length >= config.cluster.restartThreshold) {
      return false;
    }

    return true;
  }

  /**
   * Record a worker restart attempt
   */
  recordWorkerRestart(workerId) {
    if (!this.workerRestarts.has(workerId)) {
      this.workerRestarts.set(workerId, []);
    }
    this.workerRestarts.get(workerId).push(Date.now());
  }

  /**
   * Perform periodic health checks
   */
  performHealthCheck() {
    try {
      // Check all workers for missing heartbeats
      const unhealthyWorkers = this.healthMonitor.checkAllHeartbeats();

      if (unhealthyWorkers.length > 0) {
        logger.warn('Unhealthy workers detected', {
          count: unhealthyWorkers.length,
          workers: unhealthyWorkers,
        });

        // Kill unhealthy workers to trigger restart
        for (const workerId of unhealthyWorkers) {
          const worker = this.cluster.workers[workerId];
          if (worker) {
            logger.warn('Killing unhealthy worker', { workerId });
            worker.kill();
          }
        }
      }

      // Check overall system health
      const systemHealth = this.healthMonitor.getSystemHealth();
      if (systemHealth === HEALTH_STATUS.UNHEALTHY) {
        // Alert admins but keep serving (uptime at all costs)
        logger.error('System health degraded', {
          health: systemHealth,
          workers: this.healthMonitor.getAllWorkerSummaries(),
        });
        emailAlerts.alertSystemHealthDegraded(
          systemHealth,
          this.healthMonitor.getAllWorkerSummaries()
        );
      }

      // Check for auto-disable of maintenance mode
      getMaintenanceManager().checkAutoDisable();

    } catch (err) {
      // Never let the watchdog crash
      logger.error('Error in watchdog health check (non-fatal)', {
        error: err.message,
      });
    }
  }

  /**
   * Graceful rolling restart of all workers
   * Restarts workers one at a time, maintaining availability
   */
  async gracefulRollingRestart(reason = 'Configuration updated') {
    if (this.isRollingRestart) {
      logger.warn('Rolling restart already in progress');
      return;
    }

    this.isRollingRestart = true;
    const startTime = Date.now();

    try {
      logger.info('Starting graceful rolling restart', {
        reason,
        workerCount: Object.keys(this.cluster.workers || {}).length,
      });

      await emailAlerts.alertRollingRestartStarted(
        Object.keys(this.cluster.workers || {}).length,
        reason
      );

      // Get list of workers to restart
      const workers = Object.values(this.cluster.workers || {}).filter(w => w);

      for (const worker of workers) {
        await this.gracefullyRestartWorker(worker);
      }

      const durationSeconds = Math.round((Date.now() - startTime) / 1000);
      logger.info('Rolling restart completed', {
        duration: `${durationSeconds}s`,
        workersRestarted: workers.length,
      });

      await emailAlerts.alertRollingRestartCompleted(workers.length, durationSeconds);

    } catch (err) {
      logger.error('Error during rolling restart', {
        error: err.message,
      });
    } finally {
      this.isRollingRestart = false;
    }
  }

  /**
   * Gracefully restart a single worker
   * 1. Mark as draining (stop accepting new connections)
   * 2. Wait for in-flight requests to complete
   * 3. Shut down the worker
   * 4. Spawn replacement
   */
  async gracefullyRestartWorker(worker) {
    const workerId = worker.id;
    
    logger.info('Starting graceful worker restart', { workerId });

    return new Promise((resolve) => {
      // Send drain signal to worker
      worker.send({ cmd: 'drain' });

      // Set timeout for graceful shutdown
      const drainTimeout = setTimeout(() => {
        logger.warn('Drain timeout exceeded, killing worker', { workerId });
        worker.kill();
        resolve();
      }, config.cluster.drainTimeoutMs);

      // When worker dies, replace it
      const exitHandler = () => {
        clearTimeout(drainTimeout);
        worker.removeListener('exit', exitHandler);
        
        logger.info('Worker exited during graceful restart', { workerId });
        
        // Spawn replacement if this is still the rolling restart
        if (this.isRollingRestart) {
          logger.info('Spawning replacement worker', { workerId });
          this.cluster.fork();
        }
        
        // Wait a moment before resolving to allow next worker to start
        setTimeout(resolve, 500);
      };

      worker.once('exit', exitHandler);
    });
  }

  /**
   * Restart a specific worker by ID
   */
  restartWorker(workerId) {
    const worker = this.cluster.workers[workerId];
    if (!worker) {
      logger.warn('Worker not found for restart', { workerId });
      return false;
    }

    logger.info('Restarting worker', { workerId });
    this.gracefullyRestartWorker(worker);
    return true;
  }

  /**
   * Get health monitor for status reporting
   */
  getHealthMonitor() {
    return this.healthMonitor;
  }

  /**
   * Get watchdog status
   */
  getStatus() {
    return {
      isMonitoring: !!this.checkInterval,
      isRollingRestart: this.isRollingRestart,
      systemHealth: this.healthMonitor.getSystemHealth(),
      workers: this.healthMonitor.getAllWorkerSummaries(),
      maintenanceActive: getMaintenanceManager().getState().enabled,
    };
  }
}
