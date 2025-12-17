/**
 * Scheduled Tasks & Cron Jobs
 * 
 * Automated maintenance tasks:
 * - Scheduled rolling restarts
 * - Log rotation
 * - Cleanup operations
 * - Health reports
 */

import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import config from './config.js';
import logger from './logger.js';

/**
 * Scheduled Tasks Manager
 */
export class ScheduledTasks {
  constructor() {
    this.jobs = new Map();
  }

  /**
   * Schedule log rotation daily
   */
  scheduleLogRotation() {
    // Run at 2 AM daily
    const job = cron.schedule('0 2 * * *', () => {
      this.rotateLog('app.log');
      this.rotateLog('error.log');
      this.rotateLog('http.log');
      logger.info('Log rotation completed');
    });

    this.jobs.set('log-rotation', job);
    logger.debug('Log rotation scheduled for 2 AM daily');
  }

  /**
   * Rotate log file
   */
  rotateLog(filename) {
    const logPath = path.join(config.paths.logs, filename);
    
    if (!fs.existsSync(logPath)) {
      return;
    }

    try {
      const stats = fs.statSync(logPath);
      const sizeGB = stats.size / (1024 * 1024 * 1024);

      // Rotate if file > 100MB
      if (sizeGB > 0.1) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(config.paths.logs, `${filename}.${timestamp}`);

        fs.renameSync(logPath, backupPath);
        logger.info('Log file rotated', { from: logPath, to: backupPath });

        // Delete logs older than 7 days
        this.cleanupOldLogs();
      }
    } catch (err) {
      logger.error('Error rotating log', { error: err.message });
    }
  }

  /**
   * Clean up logs older than retention period
   */
  cleanupOldLogs() {
    try {
      const retentionMs = config.logging.retentionDays * 24 * 60 * 60 * 1000;
      const files = fs.readdirSync(config.paths.logs);

      for (const file of files) {
        if (!file.endsWith('.log')) continue;

        const filePath = path.join(config.paths.logs, file);
        const stats = fs.statSync(filePath);
        const age = Date.now() - stats.mtimeMs;

        if (age > retentionMs) {
          fs.unlinkSync(filePath);
          logger.debug('Old log deleted', { file });
        }
      }
    } catch (err) {
      logger.error('Error cleaning up old logs', { error: err.message });
    }
  }

  /**
   * Schedule daily health report
   */
  scheduleHealthReport(onReport) {
    // Run at 6 AM daily
    const job = cron.schedule('0 6 * * *', () => {
      logger.info('Daily health report generated');
      onReport?.();
    });

    this.jobs.set('health-report', job);
    logger.debug('Daily health report scheduled for 6 AM');
  }

  /**
   * Schedule periodic rolling restart
   */
  scheduleRollingRestart(cronExpression, onRestart) {
    if (!cronExpression) {
      logger.debug('Rolling restart not scheduled (no cron expression configured)');
      return;
    }

    try {
      const job = cron.schedule(cronExpression, () => {
        logger.warn('Scheduled rolling restart triggered');
        onRestart?.();
      });

      this.jobs.set('rolling-restart', job);
      logger.info('Rolling restart scheduled', { expression: cronExpression });
    } catch (err) {
      logger.error('Invalid cron expression', { error: err.message });
    }
  }

  /**
   * Stop all scheduled tasks
   */
  stopAll() {
    for (const [name, job] of this.jobs.entries()) {
      job.stop();
      logger.debug('Scheduled task stopped', { name });
    }
    this.jobs.clear();
  }

  /**
   * Get active jobs
   */
  getActiveJobs() {
    return Array.from(this.jobs.keys());
  }
}

// Singleton instance
let scheduledTasks = null;

/**
 * Get or create scheduled tasks manager
 */
export function getScheduledTasks() {
  if (!scheduledTasks) {
    scheduledTasks = new ScheduledTasks();
  }
  return scheduledTasks;
}
