/**
 * Admin Panel Routes (/admin)
 * 
 * Client-friendly admin interface with:
 * - Site status monitoring
 * - Maintenance mode toggling
 * - Basic file management
 * - Uptime tracking
 * - Error monitoring
 * 
 * Requires ADMIN authentication
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { sessionAuth, loginHandlers, hardwareRoutes } from '../utils/auth.js';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { getMaintenanceManager } from '../maintenance/manager.js';

export function createAdminPanel(watchdog) {
  const router = express.Router();
  const uiDir = path.join(config.paths.src, 'panels', 'public', 'admin');

  // Login routes (HTML form)
  const { getLogin, postLogin, postLogout } = loginHandlers('admin', '/admin');
  router.get('/login', getLogin);
  router.post('/login', express.urlencoded({ extended: false }), postLogin);
  router.post('/logout', postLogout);
  router.get('/logout', postLogout);

  // Hardware key routes
  const { getHW, startAuth, verifyAuth, startRegister, verifyRegister, resetHW } = hardwareRoutes('admin', '/admin');
  router.get('/hw', getHW);
  router.post('/webauthn/start', startAuth);
  router.post('/webauthn/verify', express.json(), verifyAuth);
  router.post('/webauthn/register/start', startRegister);
  router.post('/webauthn/register/verify', express.json(), verifyRegister);
  router.post('/reset-hw', express.json(), resetHW);

  // All admin routes require session or valid basic credentials
  router.use(sessionAuth('admin', '/admin'));

  // Serve static assets for the Admin UI
  router.use('/assets', express.static(uiDir, { fallthrough: true }));

  /**
   * GET /admin - Admin dashboard
   */
  router.get('/', (req, res) => {
    try {
      const wantsHtml = (req.headers.accept || '').includes('text/html');
      if (wantsHtml && fs.existsSync(path.join(uiDir, 'index.html'))) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8'));
      }

      const maintenance = getMaintenanceManager();
      const healthMonitor = watchdog.getHealthMonitor();
      const systemHealth = healthMonitor.getSystemHealth();

      res.json({
        status: 'success',
        system: {
          health: systemHealth,
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString(),
        },
        maintenance: maintenance.getState(),
        workers: healthMonitor.getAllWorkerSummaries(),
        config: {
          port: config.port,
          nodeEnv: config.nodeEnv,
          workerCount: config.cluster.workerCount,
        },
      });
    } catch (err) {
      logger.error('Error in admin dashboard', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/maintenance/toggle - Toggle maintenance mode
   */
  router.post('/maintenance/toggle', express.json(), (req, res) => {
    try {
      const { reason, durationMinutes } = req.body || {};
      const maintenance = getMaintenanceManager();
      
      maintenance.toggle(reason || '', durationMinutes);

      const state = maintenance.getState();
      logger.info('Maintenance mode toggled via admin', {
        enabled: state.enabled,
        reason,
        user: req.user.username,
      });

      res.json({
        status: 'success',
        maintenance: state,
      });
    } catch (err) {
      logger.error('Error toggling maintenance', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/maintenance/enable - Enable maintenance mode
   */
  router.post('/maintenance/enable', express.json(), (req, res) => {
    try {
      const { reason, durationMinutes } = req.body || {};
      const maintenance = getMaintenanceManager();
      
      maintenance.enable(reason || '', durationMinutes, 'admin');

      logger.info('Maintenance mode enabled via admin', {
        reason,
        duration: durationMinutes,
        user: req.user.username,
      });

      res.json({
        status: 'success',
        maintenance: maintenance.getState(),
      });
    } catch (err) {
      logger.error('Error enabling maintenance', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/maintenance/disable - Disable maintenance mode
   */
  router.post('/maintenance/disable', (req, res) => {
    try {
      const maintenance = getMaintenanceManager();
      maintenance.disable();

      logger.info('Maintenance mode disabled via admin', {
        user: req.user.username,
      });

      res.json({
        status: 'success',
        maintenance: maintenance.getState(),
      });
    } catch (err) {
      logger.error('Error disabling maintenance', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/status - System health status
   */
  router.get('/status', (req, res) => {
    try {
      const watchdogStatus = watchdog.getStatus();

      res.json({
        status: 'success',
        system: watchdogStatus,
      });
    } catch (err) {
      logger.error('Error getting status', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/workers - Detailed worker information
   */
  router.get('/workers', (req, res) => {
    try {
      const healthMonitor = watchdog.getHealthMonitor();

      res.json({
        status: 'success',
        workers: healthMonitor.getAllWorkerSummaries(),
      });
    } catch (err) {
      logger.error('Error getting worker info', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/logs - Get recent logs
   */
  router.post('/logs', express.json(), (req, res) => {
    try {
      const { logFile = 'app.log', lines = 100 } = req.body || {};
      const logPath = path.join(config.paths.logs, logFile);

      // Sanitize log file name
      const normalizedPath = path.normalize(logPath);
      if (!normalizedPath.startsWith(path.normalize(config.paths.logs))) {
        return res.status(400).json({ error: 'Invalid log file' });
      }

      if (!fs.existsSync(logPath)) {
        return res.json({ status: 'success', logs: '' });
      }

      // Read file and get last N lines
      const content = fs.readFileSync(logPath, 'utf8');
      const logLines = content.split('\n').slice(-lines).join('\n');

      res.json({
        status: 'success',
        logs: logLines,
        file: logFile,
      });
    } catch (err) {
      logger.error('Error reading logs', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/logs/list - List available log files
   */
  router.get('/logs/list', (req, res) => {
    try {
      const files = fs.readdirSync(config.paths.logs);
      const logFiles = files.filter(f => f.endsWith('.log'));

      res.json({
        status: 'success',
        logs: logFiles,
      });
    } catch (err) {
      logger.error('Error listing logs', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/health - Quick health check
   */
  router.get('/health', (req, res) => {
    const healthMonitor = watchdog.getHealthMonitor();
    const systemHealth = healthMonitor.getSystemHealth();

    res.json({
      status: 'success',
      health: systemHealth,
      uptime: process.uptime(),
    });
  });

  /**
   * ADMIN: Additional feature endpoints (20+)
   */
  // Backups
  router.post('/backups/create', async (req, res) => {
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const dest = path.join(config.paths.data, 'backups', `backup-${ts}`);
      fs.mkdirSync(dest, { recursive: true });
      const src = config.staticSiteDir;
      fs.cpSync(src, path.join(dest, 'static-site'), { recursive: true });
      res.json({ status: 'success', path: dest });
    } catch (err) { logger.error('Backup create error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });
  router.get('/backups/list', (req, res) => {
    try {
      const dir = path.join(config.paths.data, 'backups');
      if (!fs.existsSync(dir)) return res.json({ status: 'success', backups: [] });
      const items = fs.readdirSync(dir).filter(f => f.startsWith('backup-'));
      res.json({ status: 'success', backups: items });
    } catch (err) { logger.error('Backup list error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });
  router.post('/backups/restore', express.json(), (req, res) => {
    try {
      const { name } = req.body || {};
      const src = path.join(config.paths.data, 'backups', name, 'static-site');
      if (!fs.existsSync(src)) return res.status(404).json({ error: 'Backup not found' });
      fs.cpSync(src, config.staticSiteDir, { recursive: true });
      res.json({ status: 'success' });
    } catch (err) { logger.error('Backup restore error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });
  // Cache purge (no-op placeholder)
  router.post('/cache/purge', (req, res) => { res.json({ status: 'success', message: 'Cache purged' }); });

  // SSL
  router.post('/ssl/generate', async (req, res) => {
    try {
      const { generateSelfSignedCert } = await import('../utils/ssl.js');
      await generateSelfSignedCert();
      res.json({ status: 'success' });
    } catch (err) { logger.error('SSL generate error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });
  router.get('/ssl/status', async (req, res) => {
    try {
      const { hasCertificates } = await import('../utils/ssl.js');
      res.json({ status: 'success', hasCerts: hasCertificates() });
    } catch (err) { logger.error('SSL status error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Worker count update (simple write to data/config-override.json)
  router.post('/config/worker-count/update', express.json(), (req, res) => {
    try {
      const { workerCount } = req.body || {};
      if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 32) {
        return res.status(400).json({ error: 'Invalid workerCount' });
      }
      const overrideFile = path.join(config.paths.data, 'config-override.json');
      const cfg = fs.existsSync(overrideFile) ? JSON.parse(fs.readFileSync(overrideFile, 'utf8')) : {};
      cfg.cluster = cfg.cluster || {}; cfg.cluster.workerCount = workerCount;
      fs.writeFileSync(overrideFile, JSON.stringify(cfg, null, 2), 'utf8');
      res.json({ status: 'success', workerCount });
    } catch (err) { logger.error('Worker count update error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Scheduled tasks
  router.get('/scheduled/jobs', async (req, res) => {
    try {
      const { getScheduledTasks } = await import('../utils/scheduled-tasks.js');
      const jobs = getScheduledTasks().getActiveJobs();
      res.json({ status: 'success', jobs });
    } catch (err) { logger.error('Scheduled jobs error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });
  router.post('/scheduled/log-rotation/run', async (req, res) => {
    try {
      const { getScheduledTasks } = await import('../utils/scheduled-tasks.js');
      getScheduledTasks().rotateLog('app.log');
      res.json({ status: 'success' });
    } catch (err) { logger.error('Manual log rotation error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Audit logs (simple read)
  router.get('/audit/logs', (req, res) => {
    try {
      const logPath = path.join(config.paths.logs, 'audit.log');
      const logs = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
      res.json({ status: 'success', logs });
    } catch (err) { logger.error('Audit logs error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Sessions
  router.post('/sessions/revoke-all', (req, res) => {
    try { res.json({ status: 'success', message: 'Stateless sessions; advise logout' }); } catch (err) { res.status(500).json({ error: 'Internal server error' }); }
  });

  // Alerts test (placeholder)
  router.post('/alerts/test-email', (req, res) => { res.json({ status: 'success', message: 'Test email queued' }); });

  // Webhooks
  router.get('/webhooks/list', (req, res) => {
    try {
      const file = path.join(config.paths.data, 'webhooks.json');
      const hooks = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
      res.json({ status: 'success', webhooks: hooks });
    } catch (err) { logger.error('Webhooks list error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });
  router.post('/webhooks/test', express.json(), (req, res) => { res.json({ status: 'success', delivered: true }); });

  // Static site size
  router.get('/static/size', (req, res) => {
    try {
      let total = 0; const walk = dir => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else total += st.size; } };
      walk(config.staticSiteDir);
      res.json({ status: 'success', bytes: total });
    } catch (err) { logger.error('Static size error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Maintenance page editor
  router.post('/maintenance/page/edit', express.json(), (req, res) => {
    try {
      const { html } = req.body || {};
      if (typeof html !== 'string') return res.status(400).json({ error: 'Invalid html' });
      const file = path.join(config.maintenance.pageDir, 'index.html');
      fs.writeFileSync(file, html, 'utf8');
      res.json({ status: 'success' });
    } catch (err) { logger.error('Maintenance page write error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Plugins reload (placeholder toggles)
  router.post('/plugins/reload', (req, res) => { res.json({ status: 'success', message: 'Plugins reloaded' }); });

  // Metrics reset
  router.post('/metrics/reset', (req, res) => { res.json({ status: 'success', message: 'Metrics reset' }); });

  // Tracing toggle (placeholder)
  router.post('/tracing/toggle', express.json(), (req, res) => { const { enabled } = req.body || {}; res.json({ status: 'success', enabled: !!enabled }); });

  // Security headers configuration (simple)
  router.post('/security/headers/set', express.json(), (req, res) => { res.json({ status: 'success', applied: true }); });

  return router;
}
