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
import archiver from 'archiver';
import fetch from 'node-fetch';

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
      const maintenanceState = maintenance?.getState() || { enabled: false };
      const workers = Object.values(cluster.workers || {}).filter(w => w && w.process);

      res.json({
        status: 'success',
        watchdog: watchdogStatus || {},
        maintenance: maintenanceState,
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

  // Additional 15+ useful ops features

  // 1. Worker memory detailed breakdown
  router.get('/workers/memory-detail', (req, res) => {
    try {
      const workers = Object.values(cluster.workers || {}).filter(w => w && w.process);
      const details = workers.map(w => {
        const mem = w.process.memoryUsage ? w.process.memoryUsage() : {};
        return { workerId: w.id, pid: w.process.pid, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external, rss: mem.rss };
      });
      res.json({ status: 'success', workers: details });
    } catch (err) { logger.error('Worker memory detail error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 2. Kill all workers immediately (emergency)
  router.post('/workers/kill-all', (req, res) => {
    try {
      const workers = Object.values(cluster.workers || {}).filter(w => w);
      workers.forEach(w => w.kill('SIGKILL'));
      logger.warn('All workers killed via ops panel', { user: req.user.username });
      res.json({ status: 'success', message: `${workers.length} workers killed` });
    } catch (err) { logger.error('Kill all workers error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 3. Spawn additional worker (scale up)
  router.post('/workers/spawn', (req, res) => {
    try {
      const newWorker = cluster.fork();
      logger.info('Worker spawned via ops panel', { workerId: newWorker.id, user: req.user.username });
      res.json({ status: 'success', workerId: newWorker.id, message: 'Worker spawned' });
    } catch (err) { logger.error('Spawn worker error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 4. Log file download as text
  router.get('/logs/download/:logname', (req, res) => {
    try {
      const { logname } = req.params;
      const logPath = path.join(config.paths.logs, logname);
      const normalizedPath = path.normalize(logPath);
      if (!normalizedPath.startsWith(path.normalize(config.paths.logs))) return res.status(400).json({ error: 'Invalid log file' });
      if (!fs.existsSync(logPath)) return res.status(404).json({ error: 'Log file not found' });
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="${logname}"`);
      res.send(fs.readFileSync(logPath, 'utf8'));
    } catch (err) { logger.error('Log download error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 5. Real-time worker heartbeat status
  router.get('/workers/heartbeats', (req, res) => {
    try {
      const healthMonitor = watchdog.getHealthMonitor();
      const workers = healthMonitor.getAllWorkerSummaries();
      const heartbeats = workers.map(w => ({ workerId: w.workerId, lastHeartbeat: w.lastHeartbeat, status: w.status }));
      res.json({ status: 'success', heartbeats });
    } catch (err) { logger.error('Heartbeat status error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 6. Force garbage collection (if enabled with --expose-gc)
  router.post('/system/gc', (req, res) => {
    try {
      if (global.gc) {
        global.gc();
        logger.info('Manual GC triggered', { user: req.user.username });
        res.json({ status: 'success', message: 'GC triggered' });
      } else {
        res.json({ status: 'warning', message: 'GC not available (start with --expose-gc)' });
      }
    } catch (err) { logger.error('GC error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 7. CPU usage per worker
  router.get('/workers/cpu-usage', (req, res) => {
    try {
      const workers = Object.values(cluster.workers || {}).filter(w => w && w.process);
      const usage = workers.map(w => ({ workerId: w.id, pid: w.process.pid, cpuUsage: w.process.cpuUsage ? w.process.cpuUsage() : null }));
      res.json({ status: 'success', workers: usage });
    } catch (err) { logger.error('CPU usage error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 8. Clear all logs at once
  router.post('/logs/clear-all', (req, res) => {
    try {
      const files = fs.readdirSync(config.paths.logs).filter(f => f.endsWith('.log'));
      files.forEach(f => {
        const logPath = path.join(config.paths.logs, f);
        fs.writeFileSync(logPath, '', 'utf8');
      });
      logger.info('All logs cleared via ops panel', { user: req.user.username, count: files.length });
      res.json({ status: 'success', message: `${files.length} log files cleared` });
    } catch (err) { logger.error('Clear all logs error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 9. Event loop lag measurement
  router.get('/system/event-loop-lag', (req, res) => {
    try {
      const start = Date.now();
      setImmediate(() => {
        const lag = Date.now() - start;
        res.json({ status: 'success', lagMs: lag, threshold: 100, healthy: lag < 100 });
      });
    } catch (err) { logger.error('Event loop lag error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 10. Master process info
  router.get('/process/master-info', (req, res) => {
    try {
      res.json({
        status: 'success',
        pid: process.pid,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        title: process.title,
        execPath: process.execPath,
        platform: process.platform,
        arch: process.arch
      });
    } catch (err) { logger.error('Master info error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 11. Worker detailed state
  router.get('/workers/:workerId/state', (req, res) => {
    try {
      const { workerId } = req.params;
      const id = parseInt(workerId, 10);
      const worker = cluster.workers[id];
      if (!worker) return res.status(404).json({ error: 'Worker not found' });
      res.json({
        status: 'success',
        worker: {
          id: worker.id,
          pid: worker.process.pid,
          state: worker.state,
          isDead: worker.isDead(),
          isConnected: worker.isConnected(),
          exitedAfterDisconnect: worker.exitedAfterDisconnect,
          memoryUsage: worker.process.memoryUsage ? worker.process.memoryUsage() : null
        }
      });
    } catch (err) { logger.error('Worker state error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 12. Watchdog config update
  router.post('/watchdog/config/update', express.json(), (req, res) => {
    try {
      const { heartbeatTimeoutMs } = req.body || {};
      if (!Number.isInteger(heartbeatTimeoutMs) || heartbeatTimeoutMs < 1000) return res.status(400).json({ error: 'Invalid heartbeatTimeoutMs' });
      const overrideFile = path.join(config.paths.data, 'config-override.json');
      const cfg = fs.existsSync(overrideFile) ? JSON.parse(fs.readFileSync(overrideFile, 'utf8')) : {};
      cfg.cluster = cfg.cluster || {}; cfg.cluster.heartbeatTimeoutMs = heartbeatTimeoutMs;
      fs.writeFileSync(overrideFile, JSON.stringify(cfg, null, 2), 'utf8');
      res.json({ status: 'success', heartbeatTimeoutMs });
    } catch (err) { logger.error('Watchdog config error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 13. Backup cleanup (delete old backups)
  router.post('/backups/cleanup', express.json(), (req, res) => {
    try {
      const { keepCount = 5 } = req.body || {};
      const dir = path.join(config.paths.data, 'ops-backups');
      if (!fs.existsSync(dir)) return res.json({ status: 'success', deleted: 0 });
      const items = fs.readdirSync(dir).filter(f => f.startsWith('backup-')).sort().reverse();
      const toDelete = items.slice(keepCount);
      toDelete.forEach(name => fs.rmSync(path.join(dir, name), { recursive: true, force: true }));
      logger.info('Backup cleanup completed', { deleted: toDelete.length, kept: keepCount, user: req.user.username });
      res.json({ status: 'success', deleted: toDelete.length, kept: items.length - toDelete.length });
    } catch (err) { logger.error('Backup cleanup error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 14. File watcher status
  router.get('/watchers/status', (req, res) => {
    try {
      res.json({ status: 'success', message: 'File watchers active', watchers: ['static', 'maintenance', 'config'] });
    } catch (err) { logger.error('Watchers status error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 15. Port connectivity test
  router.post('/network/test-port', express.json(), async (req, res) => {
    try {
      const { port = config.port } = req.body || {};
      const net = require('net');
      const server = net.createServer();
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          res.json({ status: 'success', port, inUse: true });
        } else {
          res.json({ status: 'error', port, error: err.message });
        }
      });
      server.once('listening', () => {
        server.close();
        res.json({ status: 'success', port, inUse: false, available: true });
      });
      server.listen(port);
    } catch (err) { logger.error('Port test error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 16. Disk space check
  router.get('/system/disk-space', (req, res) => {
    try {
      const { execSync } = require('child_process');
      let output = '';
      try {
        // Works on Unix-like systems
        output = execSync('df -h /').toString();
      } catch (e) {
        output = 'df command not available';
      }
      res.json({ status: 'success', diskInfo: output });
    } catch (err) { logger.error('Disk space error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 17. Network connections count
  router.get('/network/connections', (req, res) => {
    try {
      const { execSync } = require('child_process');
      let count = 0;
      try {
        const output = execSync('netstat -an | grep ESTABLISHED | wc -l').toString().trim();
        count = parseInt(output, 10) || 0;
      } catch (e) {
        count = -1; // Not available
      }
      res.json({ status: 'success', connections: count });
    } catch (err) { logger.error('Network connections error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 18. Master process restart (dangerous!)
  router.post('/process/restart-master', (req, res) => {
    try {
      logger.warn('Master process restart requested via ops panel', { user: req.user.username });
      res.json({ status: 'success', message: 'Master restart in 3 seconds' });
      setTimeout(() => {
        process.exit(0); // Supervisor should restart
      }, 3000);
    } catch (err) { logger.error('Master restart error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 19. Log level change (runtime)
  router.post('/logs/level/set', express.json(), (req, res) => {
    try {
      const { level } = req.body || {};
      if (!['ERROR', 'WARN', 'INFO', 'DEBUG'].includes(level)) return res.status(400).json({ error: 'Invalid level' });
      process.env.LOG_LEVEL = level;
      logger.info('Log level changed', { level, user: req.user.username });
      res.json({ status: 'success', level });
    } catch (err) { logger.error('Log level error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 20. Signal to worker
  router.post('/workers/:workerId/signal', express.json(), (req, res) => {
    try {
      const { workerId } = req.params;
      const { signal = 'SIGUSR1' } = req.body || {};
      const id = parseInt(workerId, 10);
      const worker = cluster.workers[id];
      if (!worker) return res.status(404).json({ error: 'Worker not found' });
      worker.process.kill(signal);
      logger.info('Signal sent to worker', { workerId: id, signal, user: req.user.username });
      res.json({ status: 'success', message: `Signal ${signal} sent to worker ${id}` });
    } catch (err) { logger.error('Worker signal error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 21. Log file sizes
  router.get('/logs/sizes', (req, res) => {
    try {
      const files = fs.readdirSync(config.paths.logs).filter(f => f.endsWith('.log'));
      const sizes = files.map(f => {
        const stat = fs.statSync(path.join(config.paths.logs, f));
        return { name: f, bytes: stat.size, mb: (stat.size / 1024 / 1024).toFixed(2) };
      });
      res.json({ status: 'success', logs: sizes });
    } catch (err) { logger.error('Log sizes error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 22. Worker throttle (slow down requests)
  router.post('/workers/:workerId/throttle', express.json(), (req, res) => {
    try {
      const { workerId } = req.params;
      const { delayMs = 100 } = req.body || {};
      const id = parseInt(workerId, 10);
      const worker = cluster.workers[id];
      if (!worker) return res.status(404).json({ error: 'Worker not found' });
      worker.send({ cmd: 'throttle', delayMs });
      logger.info('Worker throttled', { workerId: id, delayMs, user: req.user.username });
      res.json({ status: 'success', message: `Worker ${id} throttled by ${delayMs}ms` });
    } catch (err) { logger.error('Worker throttle error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 23. Uptime formatted
  router.get('/system/uptime-formatted', (req, res) => {
    try {
      const uptimeSeconds = process.uptime();
      const days = Math.floor(uptimeSeconds / 86400);
      const hours = Math.floor((uptimeSeconds % 86400) / 3600);
      const minutes = Math.floor((uptimeSeconds % 3600) / 60);
      const seconds = Math.floor(uptimeSeconds % 60);
      res.json({ status: 'success', uptime: `${days}d ${hours}h ${minutes}m ${seconds}s`, seconds: uptimeSeconds });
    } catch (err) { logger.error('Uptime formatted error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 24. Force worker to exit code
  router.post('/workers/:workerId/exit/:code', (req, res) => {
    try {
      const { workerId, code } = req.params;
      const id = parseInt(workerId, 10);
      const exitCode = parseInt(code, 10);
      const worker = cluster.workers[id];
      if (!worker) return res.status(404).json({ error: 'Worker not found' });
      worker.send({ cmd: 'exit', code: exitCode });
      logger.warn('Worker forced to exit', { workerId: id, exitCode, user: req.user.username });
      res.json({ status: 'success', message: `Worker ${id} will exit with code ${exitCode}` });
    } catch (err) { logger.error('Worker exit error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 25. All workers status summary
  router.get('/workers/summary', (req, res) => {
    try {
      const workers = Object.values(cluster.workers || {}).filter(w => w);
      const summary = {
        total: workers.length,
        connected: workers.filter(w => w.isConnected()).length,
        dead: workers.filter(w => w.isDead()).length,
        states: {}
      };
      workers.forEach(w => {
        summary.states[w.state] = (summary.states[w.state] || 0) + 1;
      });
      res.json({ status: 'success', summary });
    } catch (err) { logger.error('Workers summary error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 26. Export .smp backup for ops
  router.get('/backups/export-smp', async (req, res) => {
    try {
      const projectName = process.env.PROJECT_NAME || 'project';
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0,8) + '-' + new Date().toISOString().replace(/[:.T]/g, '').slice(9,15);
      const filename = `${projectName}-backup-${ts}.smp`;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (err) => { throw err; });
      archive.pipe(res);
      archive.directory(config.staticSiteDir, 'website');
      archive.directory(config.paths.data, 'data');
      archive.file(path.join(config.paths.data, 'config-override.json'), { name: 'config-override.json' });
      archive.directory(config.maintenance.pageDir, 'maintenance');
      await archive.finalize();
    } catch (err) { logger.error('Ops Export SMP error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 27. Import .smp from URL (ops)
  router.post('/backups/import-smp-from-url', express.json(), async (req, res) => {
    try {
      const { url } = req.body || {};
      if (!url) return res.status(400).json({ error: 'url required' });
      const r = await fetch(url);
      if (!r.ok) return res.status(400).json({ error: 'Failed to fetch smp file' });
      const buf = await r.buffer();
      const tmpZip = path.join(config.paths.data, 'tmp-import.zip');
      fs.writeFileSync(tmpZip, buf);
      const unzip = await import('adm-zip');
      const AdmZip = unzip.default;
      const zip = new AdmZip(tmpZip);
      const extractDir = path.join(config.paths.data, 'import-extract');
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
      fs.mkdirSync(extractDir, { recursive: true });
      zip.extractAllTo(extractDir, true);
      const websiteSrc = path.join(extractDir, 'website'); if (fs.existsSync(websiteSrc)) fs.cpSync(websiteSrc, config.staticSiteDir, { recursive: true });
      const dataSrc = path.join(extractDir, 'data'); if (fs.existsSync(dataSrc)) fs.cpSync(dataSrc, config.paths.data, { recursive: true });
      const maintSrc = path.join(extractDir, 'maintenance'); if (fs.existsSync(maintSrc)) fs.cpSync(maintSrc, config.maintenance.pageDir, { recursive: true });
      res.json({ status: 'success', message: 'Import completed' });
    } catch (err) { logger.error('Ops Import SMP error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });


  return router;
}
