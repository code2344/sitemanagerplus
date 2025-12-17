/**
 * Health Check System
 * 
 * Tracks worker health metrics:
 * - Heartbeat monitoring
 * - Memory usage
 * - Request handling
 * - Error tracking
 * 
 * Workers are considered unhealthy if:
 * - They miss 2+ consecutive heartbeats
 * - Memory usage exceeds threshold
 * - High error rate detected
 */

import config from '../utils/config.js';
import logger from '../utils/logger.js';

/**
 * Health status constants
 */
export const HEALTH_STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
};

/**
 * Per-worker health tracking object
 */
export class WorkerHealth {
  constructor(workerId) {
    this.workerId = workerId;
    this.status = HEALTH_STATUS.HEALTHY;
    this.lastHeartbeat = Date.now();
    this.heartbeatMissCount = 0;
    this.startTime = Date.now();
    this.restartCount = 0;
    this.lastRestartTime = null;
    this.errorCount = 0;
    this.requestCount = 0;
    this.memoryUsageMB = 0;
    this.eventLoopLagMs = 0;
  }

  /**
   * Called when master receives heartbeat from worker
   */
  recordHeartbeat(healthData) {
    this.lastHeartbeat = Date.now();
    this.heartbeatMissCount = 0; // Reset miss counter on successful heartbeat
    
    if (healthData) {
      this.memoryUsageMB = healthData.memoryUsageMB || 0;
      this.eventLoopLagMs = healthData.eventLoopLagMs || 0;
      this.errorCount = healthData.errorCount || 0;
      this.requestCount = healthData.requestCount || 0;
    }

    this.updateStatus();
  }

  /**
   * Called periodically by master to detect missing heartbeats
   */
  checkHeartbeat() {
    const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;
    
    if (timeSinceLastHeartbeat > config.cluster.heartbeatTimeoutMs) {
      this.heartbeatMissCount++;
      
      // Mark as unhealthy if we've missed multiple heartbeats
      if (this.heartbeatMissCount >= 2) {
        this.status = HEALTH_STATUS.UNHEALTHY;
        logger.warn('Worker marked unhealthy: missing heartbeats', {
          workerId: this.workerId,
          missCount: this.heartbeatMissCount,
          timeSinceHeartbeatMs: timeSinceLastHeartbeat,
        });
        return false; // Unhealthy
      }
    }

    return this.updateStatus();
  }

  /**
   * Update health status based on metrics
   */
  updateStatus() {
    const previousStatus = this.status;

    // Check memory threshold
    if (this.memoryUsageMB > config.cluster.memoryThresholdMB) {
      this.status = HEALTH_STATUS.UNHEALTHY;
    }
    // Check error rate (more than 10% errors is degraded)
    else if (this.requestCount > 0 && (this.errorCount / this.requestCount) > 0.1) {
      this.status = HEALTH_STATUS.DEGRADED;
    }
    // Check event loop lag (>100ms is degraded)
    else if (this.eventLoopLagMs > 100) {
      this.status = HEALTH_STATUS.DEGRADED;
    } else {
      this.status = HEALTH_STATUS.HEALTHY;
    }

    if (previousStatus !== this.status) {
      logger.info(`Worker ${this.workerId} status changed`, {
        from: previousStatus,
        to: this.status,
        memory: `${this.memoryUsageMB}MB`,
        errorRate: this.requestCount > 0 ? `${((this.errorCount / this.requestCount) * 100).toFixed(2)}%` : 'N/A',
      });
    }

    return this.status === HEALTH_STATUS.HEALTHY;
  }

  /**
   * Record a restart for crash loop detection
   */
  recordRestart() {
    this.restartCount++;
    this.lastRestartTime = Date.now();
  }

  /**
   * Get uptime in milliseconds
   */
  getUptime() {
    return Date.now() - this.startTime;
  }

  /**
   * Get summary for status endpoint
   */
  getSummary() {
    return {
      workerId: this.workerId,
      status: this.status,
      uptime: this.getUptime(),
      restarts: this.restartCount,
      memoryMB: this.memoryUsageMB,
      eventLoopLagMs: this.eventLoopLagMs,
      errorCount: this.errorCount,
      requestCount: this.requestCount,
      errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount * 100).toFixed(2) + '%' : 'N/A',
      lastHeartbeat: new Date(this.lastHeartbeat).toISOString(),
    };
  }
}

/**
 * Master-side health monitor
 */
export class HealthMonitor {
  constructor() {
    this.workers = new Map(); // workerId -> WorkerHealth
  }

  /**
   * Register a new worker
   */
  registerWorker(workerId) {
    const health = new WorkerHealth(workerId);
    this.workers.set(workerId, health);
    return health;
  }

  /**
   * Process heartbeat from worker
   */
  processHeartbeat(workerId, healthData) {
    let health = this.workers.get(workerId);
    if (!health) {
      health = this.registerWorker(workerId);
    }
    health.recordHeartbeat(healthData);
  }

  /**
   * Check all workers for missing heartbeats
   * Returns array of unhealthy worker IDs
   */
  checkAllHeartbeats() {
    const unhealthyWorkers = [];
    
    for (const [workerId, health] of this.workers.entries()) {
      if (!health.checkHeartbeat()) {
        unhealthyWorkers.push(workerId);
      }
    }

    return unhealthyWorkers;
  }

  /**
   * Get overall system health
   * Returns HEALTHY if all workers healthy, DEGRADED if some degraded, UNHEALTHY if any unhealthy
   */
  getSystemHealth() {
    let hasUnhealthy = false;
    let hasDegraded = false;

    for (const health of this.workers.values()) {
      if (health.status === HEALTH_STATUS.UNHEALTHY) {
        hasUnhealthy = true;
      } else if (health.status === HEALTH_STATUS.DEGRADED) {
        hasDegraded = true;
      }
    }

    if (hasUnhealthy) return HEALTH_STATUS.UNHEALTHY;
    if (hasDegraded) return HEALTH_STATUS.DEGRADED;
    return HEALTH_STATUS.HEALTHY;
  }

  /**
   * Get all workers' health summary
   */
  getAllWorkerSummaries() {
    const summaries = [];
    for (const health of this.workers.values()) {
      summaries.push(health.getSummary());
    }
    return summaries;
  }

  /**
   * Remove worker from tracking (when worker exits)
   */
  removeWorker(workerId) {
    this.workers.delete(workerId);
  }
}
