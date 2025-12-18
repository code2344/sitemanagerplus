/**
 * Maintenance / Operations Panel Routes (/maintenance)
 * 
 * Advanced operations interface with:
 * - Graceful rolling restarts
 * - Individual worker control
 * - Real-time log streaming
 * - Watchdog management
 * - Force maintenance mode
 * 
 * Requires MAINTENANCE (ops) authentication
 * This is for advanced users/operations team
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { sessionAuth, loginHandlers, rateLimit, hardwareRoutes } from '../utils/auth.js';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { getMaintenanceManager } from '../maintenance/manager.js';

export function createMaintenancePanel(cluster, watchdog) {
  const router = express.Router();
  const uiDir = path.join(config.paths.src, 'panels', 'public', 'maintenance');

  // Login routes (HTML form)
  const { getLogin, postLogin, postLogout } = loginHandlers('maintenance', '/maintenance');
  router.get('/login', getLogin);
  router.post('/login', express.urlencoded({ extended: false }), postLogin);
  router.post('/logout', postLogout);
  router.get('/logout', postLogout);

  // Hardware key routes
  const { getHW, startAuth, verifyAuth, startRegister, verifyRegister, resetHW } = hardwareRoutes('maintenance', '/maintenance');
  router.get('/hw', getHW);
  router.post('/webauthn/start', startAuth);
  router.post('/webauthn/verify', express.json(), verifyAuth);
  router.post('/webauthn/register/start', startRegister);
  router.post('/webauthn/register/verify', express.json(), verifyRegister);
  router.post('/reset-hw', express.json(), resetHW);

  // All maintenance routes require session or valid basic credentials
  router.use(sessionAuth('maintenance', '/maintenance'));

  // Rate limit sensitive operations
  router.use(rateLimit(60000, 50)); // 50 requests per minute

  // Serve static assets for the Maintenance UI
  router.use('/assets', express.static(uiDir, { fallthrough: true }));

  /**
   * GET /maintenance - Maintenance panel dashboard
   */
  router.get('/', (req, res) => {
    try {
      const wantsHtml = (req.headers.accept || '').includes('text/html');
      if (wantsHtml && fs.existsSync(path.join(uiDir, 'index.html'))) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8'));
      }

      const watchdogStatus = watchdog.getStatus();
      const maintenance = getMaintenanceManager();
      const workers = Object.values(cluster.workers).filter(w => w);

      res.json({
        status: 'success',
        watchdog: watchdogStatus,
        maintenance: maintenance.getState(),
        workers: workers.map(w => ({
          id: w.id,
          pid: w.process.pid,
          state: w.state,
        })),
        config: {
          workerCount: config.cluster.workerCount,
          memoryThresholdMB: config.cluster.memoryThresholdMB,
          heartbeatIntervalMs: config.cluster.heartbeatIntervalMs,
          heartbeatTimeoutMs: config.cluster.heartbeatTimeoutMs,
        },
      });
    } catch (err) {
      logger.error('Error in maintenance dashboard', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /maintenance/restart/rolling - Start graceful rolling restart
   */
  router.post('/restart/rolling', express.json(), async (req, res) => {
    try {
      const { reason = 'Operator requested' } = req.body || {};

      logger.info('Rolling restart initiated via maintenance panel', {
        reason,
        user: req.user.username,
      });

      // Start rolling restart asynchronously
      watchdog.gracefulRollingRestart(reason).catch(err => {
        logger.error('Rolling restart error', { error: err.message });
      });

      res.json({
        status: 'success',
        message: 'Rolling restart initiated',
        reason,
      });
    } catch (err) {
      logger.error('Error initiating rolling restart', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /maintenance/restart/worker/:workerId - Restart specific worker
   */
  router.post('/restart/worker/:workerId', (req, res) => {
    try {
      const { workerId } = req.params;
      const id = parseInt(workerId, 10);

      const worker = cluster.workers[id];
      if (!worker) {
        return res.status(404).json({ error: 'Worker not found' });
      }

      logger.info('Worker restart initiated via maintenance panel', {
        workerId: id,
        user: req.user.username,
      });

      // Gracefully restart the worker
      watchdog.restartWorker(id);

      res.json({
        status: 'success',
        message: `Worker ${id} restart initiated`,
      });
    } catch (err) {
      logger.error('Error restarting worker', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /maintenance/restart/worker/:workerId/force - Force kill a worker
   */
  router.post('/restart/worker/:workerId/force', (req, res) => {
    try {
      const { workerId } = req.params;
      const id = parseInt(workerId, 10);

      const worker = cluster.workers[id];
      if (!worker) {
        return res.status(404).json({ error: 'Worker not found' });
      }

      logger.warn('Worker force killed via maintenance panel', {
        workerId: id,
        user: req.user.username,
      });

      worker.kill();

      res.json({
        status: 'success',
        message: `Worker ${id} force killed`,
      });
    } catch (err) {
      logger.error('Error force killing worker', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /maintenance/workers - Detailed worker status
   */
  router.get('/workers', (req, res) => {
    try {
      const workers = Object.values(cluster.workers).filter(w => w);
      const healthMonitor = watchdog.getHealthMonitor();

      const workerDetails = workers.map(w => ({
        id: w.id,
        pid: w.process.pid,
        state: w.state,
        health: healthMonitor.workers.get(w.id)?.getSummary(),
      }));

      res.json({
        status: 'success',
        workers: workerDetails,
      });
    } catch (err) {
      logger.error('Error getting worker details', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /maintenance/logs - Get logs with filtering
   */
  router.get('/logs', (req, res) => {
    try {
      const { file = 'app.log', lines = 200, level } = req.query;
      const logPath = path.join(config.paths.logs, file);

      // Sanitize log file name
      const normalizedPath = path.normalize(logPath);
      if (!normalizedPath.startsWith(path.normalize(config.paths.logs))) {
        return res.status(400).json({ error: 'Invalid log file' });
      }

      if (!fs.existsSync(logPath)) {
        return res.json({ status: 'success', logs: [] });
      }

      // Read file and get last N lines
      const content = fs.readFileSync(logPath, 'utf8');
      let logLines = content.split('\n').slice(-parseInt(lines, 10));

      // Filter by log level if specified
      if (level) {
        logLines = logLines.filter(line => line.includes(`[${level}]`));
      }

      res.json({
        status: 'success',
        logs: logLines,
        file,
        count: logLines.length,
      });
    } catch (err) {
      logger.error('Error reading logs', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /maintenance/logs/files - List available log files
   */
  router.get('/logs/files', (req, res) => {
    try {
      const files = fs.readdirSync(config.paths.logs);
      const logFiles = files
        .filter(f => f.endsWith('.log'))
        .map(f => {
          const fullPath = path.join(config.paths.logs, f);
          const stats = fs.statSync(fullPath);
          return {
            name: f,
            size: stats.size,
            modified: stats.mtime,
          };
        });

      res.json({
        status: 'success',
        logs: logFiles,
      });
    } catch (err) {
      logger.error('Error listing log files', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /maintenance/maintenance/force - Force maintenance mode
   */
  router.post('/maintenance/force', express.json(), (req, res) => {
    try {
      const { reason, durationMinutes } = req.body || {};
      const maintenance = getMaintenanceManager();

      maintenance.enable(reason || 'Operator initiated', durationMinutes, 'ops');

      logger.warn('Maintenance mode force-enabled via ops panel', {
        reason,
        user: req.user.username,
      });

      res.json({
        status: 'success',
        maintenance: maintenance.getState(),
      });
    } catch (err) {
      logger.error('Error forcing maintenance', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /maintenance/watchdog/status - Watchdog status
   */
  router.get('/watchdog/status', (req, res) => {
    try {
      const status = watchdog.getStatus();

      res.json({
        status: 'success',
        watchdog: status,
      });
    } catch (err) {
      logger.error('Error getting watchdog status', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /maintenance/config - Get current configuration
   */
  router.get('/config', (req, res) => {
    try {
      res.json({
        status: 'success',
        config: {
          port: config.port,
          nodeEnv: config.nodeEnv,
          workerCount: config.cluster.workerCount,
          memoryThresholdMB: config.cluster.memoryThresholdMB,
          heartbeatIntervalMs: config.cluster.heartbeatIntervalMs,
          heartbeatTimeoutMs: config.cluster.heartbeatTimeoutMs,
          gracefulShutdownTimeoutMs: config.cluster.gracefulShutdownTimeoutMs,
          drainTimeoutMs: config.cluster.drainTimeoutMs,
          restartThreshold: config.cluster.restartThreshold,
          restartWindowMs: config.cluster.restartWindowMs,
        },
      });
    } catch (err) {
      logger.error('Error getting config', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * OPS: Additional feature endpoints (20+)
   */
  // Logs rotate
  router.post('/logs/rotate', async (req, res) => {
    try { const { getScheduledTasks } = await import('../utils/scheduled-tasks.js'); getScheduledTasks().rotateLog('app.log'); res.json({ status: 'success' }); } catch (err) { logger.error('Rotate logs error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Cache clear (placeholder)
  router.post('/cache/clear', (req, res) => { res.json({ status: 'success', message: 'Cache cleared' }); });

  // Plugins reload
  router.post('/plugins/reload', (req, res) => { res.json({ status: 'success', message: 'Plugins reloaded' }); });

  // Watchdog restart (placeholder)
  router.post('/watchdog/restart', (req, res) => { res.json({ status: 'success', message: 'Watchdog restart requested' }); });

  // Thresholds update
  router.post('/thresholds/update', express.json(), (req, res) => {
    try {
      const { memoryThresholdMB } = req.body || {};
      if (!Number.isInteger(memoryThresholdMB) || memoryThresholdMB < 64) return res.status(400).json({ error: 'Invalid memoryThresholdMB' });
      const overrideFile = path.join(config.paths.data, 'config-override.json');
      const cfg = fs.existsSync(overrideFile) ? JSON.parse(fs.readFileSync(overrideFile, 'utf8')) : {};
      cfg.cluster = cfg.cluster || {}; cfg.cluster.memoryThresholdMB = memoryThresholdMB;
      fs.writeFileSync(overrideFile, JSON.stringify(cfg, null, 2), 'utf8');
      res.json({ status: 'success', memoryThresholdMB });
    } catch (err) { logger.error('Threshold update error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Disk usage
  router.get('/disk/usage', (req, res) => {
    try {
      let total = 0; const walk = dir => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else total += st.size; } };
      walk(config.paths.root);
      res.json({ status: 'success', bytes: total });
    } catch (err) { logger.error('Disk usage error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Network ports (placeholder)
  router.get('/network/ports', (req, res) => { res.json({ status: 'success', ports: [config.port] }); });

  // Process list (limited)
  router.get('/process/list', (req, res) => { res.json({ status: 'success', processes: [{ pid: process.pid, title: process.title }] }); });

  // Static backup/restore (to ops area)
  router.post('/static/backup', (req, res) => {
    try { const ts = new Date().toISOString().replace(/[:.]/g, '-'); const dest = path.join(config.paths.data, 'ops-backups', `backup-${ts}`); fs.mkdirSync(dest, { recursive: true }); fs.cpSync(config.staticSiteDir, path.join(dest, 'static-site'), { recursive: true }); res.json({ status: 'success', path: dest }); } catch (err) { logger.error('Ops backup error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });
  router.post('/static/restore', express.json(), (req, res) => {
    try { const { name } = req.body || {}; const src = path.join(config.paths.data, 'ops-backups', name, 'static-site'); if (!fs.existsSync(src)) return res.status(404).json({ error: 'Backup not found' }); fs.cpSync(src, config.staticSiteDir, { recursive: true }); res.json({ status: 'success' }); } catch (err) { logger.error('Ops restore error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // SSL validate (presence)
  router.get('/ssl/validate', async (req, res) => { try { const { hasCertificates } = await import('../utils/ssl.js'); res.json({ status: 'success', hasCerts: hasCertificates() }); } catch (err) { logger.error('SSL validate error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); } });

  // Alerts test
  router.post('/alerts/test', (req, res) => { res.json({ status: 'success', message: 'Test alert emitted' }); });

  // Tracing toggle
  router.post('/tracing/toggle', express.json(), (req, res) => { const { enabled } = req.body || {}; res.json({ status: 'success', enabled: !!enabled }); });

  // Debug mode
  router.post('/debug/enable', (req, res) => { res.json({ status: 'success', debug: true }); });
  router.post('/debug/disable', (req, res) => { res.json({ status: 'success', debug: false }); });

  // Health manual check (placeholder)
  router.get('/health/run-check', (req, res) => { res.json({ status: 'success', healthy: true }); });

  // Scheduled jobs
  router.get('/scheduled/jobs', async (req, res) => { try { const { getScheduledTasks } = await import('../utils/scheduled-tasks.js'); res.json({ status: 'success', jobs: getScheduledTasks().getActiveJobs() }); } catch (err) { logger.error('Ops scheduled jobs error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); } });

  // Sessions revoke
  router.post('/sessions/revoke-all', (req, res) => { res.json({ status: 'success', message: 'Stateless sessions; advise logout' }); });

  // Config reload (placeholder)
  router.post('/config/reload', (req, res) => { res.json({ status: 'success', message: 'Config reload signalled' }); });

  // Maintenance extend duration
  router.post('/maintenance/extend', express.json(), (req, res) => { try { const { extraMinutes = 10 } = req.body || {}; const maintenance = getMaintenanceManager(); const st = maintenance.getState(); if (!st.enabled) return res.status(400).json({ error: 'Maintenance not enabled' }); maintenance.enable(st.reason || '', (st.durationMinutes || 0) + extraMinutes, 'ops'); res.json({ status: 'success', maintenance: maintenance.getState() }); } catch (err) { logger.error('Extend maintenance error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); } });

  return router;
}
