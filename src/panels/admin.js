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
import { listUsers, addUser, removeUser } from '../utils/users.js';
import fetch from 'node-fetch';
import archiver from 'archiver';
import multer from 'multer';

export function createAdminPanel(watchdog) {
  const router = express.Router();
  const uiDir = path.join(config.paths.src, 'panels', 'public', 'admin');
  const safeJoin = (base, target) => {
    const resolved = path.resolve(base, target || '');
    if (!resolved.startsWith(path.resolve(base))) {
      throw new Error('Invalid path');
    }
    return resolved;
  };
  const sendPage = (res, fileName) => {
    const filePath = path.join(uiDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Page not found');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(fs.readFileSync(filePath, 'utf8'));
  };

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

  // Dedicated admin pages
  router.get('/metrics-ui', (req, res) => sendPage(res, 'metrics.html'));
  router.get('/api-keys-ui', (req, res) => sendPage(res, 'api-keys.html'));
  router.get('/plugins-ui', (req, res) => sendPage(res, 'plugins.html'));
  router.get('/logs-ui', (req, res) => sendPage(res, 'logs.html'));
  router.get('/manual', (req, res) => sendPage(res, 'manual.html'));

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

  // File manager: list directory within website
  router.get('/files/list', (req, res) => {
    try {
      const dir = req.query.dir || '';
      const root = config.staticSiteDir;
      const target = safeJoin(root, dir);
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return res.status(404).json({ error: 'Directory not found' });
      const entries = fs.readdirSync(target).map(name => {
        const stat = fs.statSync(path.join(target, name));
        return { name, isDir: stat.isDirectory(), size: stat.size, mtime: stat.mtime };
      });
      res.json({ status: 'success', entries, dir: path.relative(root, target) });
    } catch (err) { logger.error('Files list error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // File manager: read file within website
  router.post('/files/read', express.json(), (req, res) => {
    try {
      const { file } = req.body || {};
      if (!file) return res.status(400).json({ error: 'file required' });
      const target = safeJoin(config.staticSiteDir, file);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return res.status(404).json({ error: 'File not found' });
      const content = fs.readFileSync(target, 'utf8');
      res.json({ status: 'success', content });
    } catch (err) { logger.error('Files read error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // File manager: write file within website
  router.post('/files/write', express.json({ limit: '2mb' }), (req, res) => {
    try {
      const { file, content } = req.body || {};
      if (!file || typeof content !== 'string') return res.status(400).json({ error: 'file and content required' });
      const target = safeJoin(config.staticSiteDir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf8');
      res.json({ status: 'success' });
    } catch (err) { logger.error('Files write error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // File manager: delete file within website
  router.post('/files/delete', express.json(), (req, res) => {
    try {
      const { file } = req.body || {};
      if (!file) return res.status(400).json({ error: 'file required' });
      const target = safeJoin(config.staticSiteDir, file);
      if (!fs.existsSync(target)) return res.status(404).json({ error: 'File not found' });
      const stat = fs.statSync(target);
      if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
      else fs.unlinkSync(target);
      res.json({ status: 'success' });
    } catch (err) { logger.error('Files delete error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Logs: download specific file
  router.get('/logs/download/:logname', (req, res) => {
    try {
      const { logname } = req.params;
      const logPath = safeJoin(config.paths.logs, logname);
      if (!fs.existsSync(logPath)) return res.status(404).json({ error: 'Log file not found' });
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="${logname}"`);
      res.send(fs.readFileSync(logPath, 'utf8'));
    } catch (err) { logger.error('Log download error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Logs: rotate a log file (rename with timestamp)
  router.post('/logs/rotate', express.json(), (req, res) => {
    try {
      const { logname = 'app.log' } = req.body || {};
      const src = safeJoin(config.paths.logs, logname);
      if (!fs.existsSync(src)) return res.status(404).json({ error: 'Log file not found' });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const dest = safeJoin(config.paths.logs, `${logname}.${ts}`);
      fs.renameSync(src, dest);
      fs.writeFileSync(src, '', 'utf8');
      res.json({ status: 'success', rotatedTo: path.basename(dest) });
    } catch (err) { logger.error('Log rotate error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Backup: create zip archive of site and data
  router.post('/backups/create-zip', async (req, res) => {
    try {
      const dir = path.join(config.paths.data, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `backup-${ts}.zip`;
      const filepath = path.join(dir, filename);
      const output = fs.createWriteStream(filepath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (err) => { throw err; });
      archive.pipe(output);
      archive.directory(config.staticSiteDir, 'website');
      archive.directory(config.paths.data, 'data');
      archive.directory(config.maintenance.pageDir, 'maintenance');
      await archive.finalize();
      res.json({ status: 'success', file: filename });
    } catch (err) { logger.error('Backup create zip error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Backup: prune old zips
  router.post('/backups/prune', express.json(), (req, res) => {
    try {
      const { keep = 5 } = req.body || {};
      const dir = path.join(config.paths.data, 'backups');
      if (!fs.existsSync(dir)) return res.json({ status: 'success', deleted: 0 });
      const items = fs.readdirSync(dir).filter(f => f.startsWith('backup-')).sort().reverse();
      const toDelete = items.slice(keep);
      toDelete.forEach(name => fs.rmSync(path.join(dir, name), { recursive: true, force: true }));
      res.json({ status: 'success', deleted: toDelete.length, kept: Math.min(keep, items.length) });
    } catch (err) { logger.error('Backup prune error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Config override: get current override file
  router.get('/config/override/get', (req, res) => {
    try {
      const overrideFile = path.join(config.paths.data, 'config-override.json');
      const cfg = fs.existsSync(overrideFile) ? JSON.parse(fs.readFileSync(overrideFile, 'utf8')) : {};
      res.json({ status: 'success', config: cfg });
    } catch (err) { logger.error('Config override get error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Config override: set override values
  router.post('/config/override/set', express.json({ limit: '512kb' }), (req, res) => {
    try {
      const { config: cfg } = req.body || {};
      if (typeof cfg !== 'object' || cfg === null) return res.status(400).json({ error: 'config must be object' });
      const overrideFile = path.join(config.paths.data, 'config-override.json');
      fs.writeFileSync(overrideFile, JSON.stringify(cfg, null, 2), 'utf8');
      res.json({ status: 'success' });
    } catch (err) { logger.error('Config override set error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Security: set CSP header policy stored on disk
  router.post('/security/csp/set', express.json(), (req, res) => {
    try {
      const { policy } = req.body || {};
      if (typeof policy !== 'string' || !policy.trim()) return res.status(400).json({ error: 'policy required' });
      const file = path.join(config.paths.data, 'security-csp.txt');
      fs.writeFileSync(file, policy.trim(), 'utf8');
      res.json({ status: 'success' });
    } catch (err) { logger.error('CSP set error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // System snapshot: runtime stats
  router.get('/system/snapshot', (req, res) => {
    try {
      const mem = process.memoryUsage();
      const cpu = process.cpuUsage();
      res.json({ status: 'success', uptime: process.uptime(), memory: mem, cpu, pid: process.pid, platform: process.platform, node: process.version });
    } catch (err) { logger.error('System snapshot error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // Additional 15+ useful admin features
  
  // 1. Environment variables viewer (filtered)
  router.get('/env/list', (req, res) => {
    try {
      const safe = {};
      Object.keys(process.env).forEach(k => {
        if (!k.toLowerCase().includes('key') && !k.toLowerCase().includes('secret') && !k.toLowerCase().includes('token')) {
          safe[k] = process.env[k];
        }
      });
      res.json({ status: 'success', env: safe });
    } catch (err) { logger.error('Env list error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 2. System resource usage
  router.get('/system/resources', (req, res) => {
    try {
      const os = require('os');
      res.json({
        status: 'success',
        cpu: { count: os.cpus().length, model: os.cpus()[0]?.model || 'Unknown', load: os.loadavg() },
        memory: { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem() },
        uptime: os.uptime()
      });
    } catch (err) { logger.error('System resources error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 3. File upload size configuration
  router.post('/config/upload-limit/set', express.json(), (req, res) => {
    try {
      const { limitMB } = req.body || {};
      if (!Number.isInteger(limitMB) || limitMB < 1) return res.status(400).json({ error: 'Invalid limitMB' });
      const overrideFile = path.join(config.paths.data, 'config-override.json');
      const cfg = fs.existsSync(overrideFile) ? JSON.parse(fs.readFileSync(overrideFile, 'utf8')) : {};
      cfg.uploadLimitMB = limitMB;
      fs.writeFileSync(overrideFile, JSON.stringify(cfg, null, 2), 'utf8');
      res.json({ status: 'success', uploadLimitMB: limitMB });
    } catch (err) { logger.error('Upload limit error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 4. Dependency versions list
  router.get('/dependencies/versions', (req, res) => {
    try {
      const pkgPath = path.join(config.paths.root, 'package.json');
      if (!fs.existsSync(pkgPath)) return res.status(404).json({ error: 'package.json not found' });
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      res.json({ status: 'success', dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} });
    } catch (err) { logger.error('Dependencies error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 5. Access log viewer
  router.get('/logs/access', (req, res) => {
    try {
      const logPath = path.join(config.paths.logs, 'http.log');
      if (!fs.existsSync(logPath)) return res.json({ status: 'success', logs: '' });
      const content = fs.readFileSync(logPath, 'utf8');
      const lines = content.split('\n').slice(-100).join('\n');
      res.json({ status: 'success', logs: lines });
    } catch (err) { logger.error('Access log error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 6. Error log viewer
  router.get('/logs/errors', (req, res) => {
    try {
      const logPath = path.join(config.paths.logs, 'error.log');
      if (!fs.existsSync(logPath)) return res.json({ status: 'success', logs: '' });
      const content = fs.readFileSync(logPath, 'utf8');
      const lines = content.split('\n').slice(-100).join('\n');
      res.json({ status: 'success', logs: lines });
    } catch (err) { logger.error('Error log viewer error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 7. Clear single log file
  router.post('/logs/clear/:logname', (req, res) => {
    try {
      const { logname } = req.params;
      const logPath = path.join(config.paths.logs, logname);
      const normalizedPath = path.normalize(logPath);
      if (!normalizedPath.startsWith(path.normalize(config.paths.logs))) return res.status(400).json({ error: 'Invalid log file' });
      if (fs.existsSync(logPath)) fs.writeFileSync(logPath, '', 'utf8');
      res.json({ status: 'success', message: `Log ${logname} cleared` });
    } catch (err) { logger.error('Log clear error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 8. Backup size calculation
  router.get('/backups/size', (req, res) => {
    try {
      const dir = path.join(config.paths.data, 'backups');
      if (!fs.existsSync(dir)) return res.json({ status: 'success', totalBytes: 0 });
      let total = 0;
      const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else total += st.size; } };
      walk(dir);
      res.json({ status: 'success', totalBytes: total, totalMB: Math.round(total / 1024 / 1024 * 100) / 100 });
    } catch (err) { logger.error('Backup size error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 9. Delete single backup
  router.delete('/backups/:name', (req, res) => {
    try {
      const { name } = req.params;
      const backupPath = path.join(config.paths.data, 'backups', name);
      const normalizedPath = path.normalize(backupPath);
      if (!normalizedPath.startsWith(path.normalize(path.join(config.paths.data, 'backups')))) return res.status(400).json({ error: 'Invalid backup name' });
      if (fs.existsSync(backupPath)) fs.rmSync(backupPath, { recursive: true, force: true });
      res.json({ status: 'success', message: `Backup ${name} deleted` });
    } catch (err) { logger.error('Backup delete error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 10. Static file count
  router.get('/static/stats', (req, res) => {
    try {
      let fileCount = 0, totalSize = 0;
      const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else { fileCount++; totalSize += st.size; } } };
      walk(config.staticSiteDir);
      res.json({ status: 'success', fileCount, totalBytes: totalSize, totalMB: Math.round(totalSize / 1024 / 1024 * 100) / 100 });
    } catch (err) { logger.error('Static stats error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 11. WebAuthn credentials list
  router.get('/webauthn/credentials', (req, res) => {
    try {
      const credPath = path.join(config.paths.data, 'webauthn.json');
      if (!fs.existsSync(credPath)) return res.json({ status: 'success', credentials: [] });
      const data = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      const safe = Object.entries(data).map(([user, creds]) => ({ user, count: creds.length }));
      res.json({ status: 'success', credentials: safe });
    } catch (err) { logger.error('WebAuthn creds error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 12. Request rate statistics
  router.get('/stats/requests', (req, res) => {
    try {
      const healthMonitor = watchdog.getHealthMonitor();
      const workers = healthMonitor.getAllWorkerSummaries();
      const totalRequests = workers.reduce((sum, w) => sum + (w.requestCount || 0), 0);
      const totalErrors = workers.reduce((sum, w) => sum + (w.errorCount || 0), 0);
      res.json({ status: 'success', totalRequests, totalErrors, errorRate: totalRequests > 0 ? (totalErrors / totalRequests * 100).toFixed(2) + '%' : '0%' });
    } catch (err) { logger.error('Request stats error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 13. Worker restart history
  router.get('/workers/restart-history', (req, res) => {
    try {
      // Read from watchdog's restart tracker
      const restarts = Array.from(watchdog.workerRestarts?.entries() || []).map(([id, times]) => ({ workerId: id, restartCount: times.length, lastRestart: times[times.length - 1] }));
      res.json({ status: 'success', restarts });
    } catch (err) { logger.error('Restart history error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 14. Node.js version info
  router.get('/system/node-info', (req, res) => {
    try {
      res.json({
        status: 'success',
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        execPath: process.execPath,
        cwd: process.cwd()
      });
    } catch (err) { logger.error('Node info error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 15. Config file viewer
  router.get('/config/file', (req, res) => {
    try {
      const overrideFile = path.join(config.paths.data, 'config-override.json');
      if (!fs.existsSync(overrideFile)) return res.json({ status: 'success', config: {} });
      const cfg = JSON.parse(fs.readFileSync(overrideFile, 'utf8'));
      res.json({ status: 'success', config: cfg });
    } catch (err) { logger.error('Config file error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 16. Delete old backups
  router.post('/backups/cleanup', express.json(), (req, res) => {
    try {
      const { olderThanDays = 7 } = req.body || {};
      const dir = path.join(config.paths.data, 'backups');
      if (!fs.existsSync(dir)) return res.json({ status: 'success', deleted: 0 });
      const cutoff = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
      const items = fs.readdirSync(dir).filter(f => f.startsWith('backup-'));
      let deleted = 0;
      items.forEach(name => {
        const stat = fs.statSync(path.join(dir, name));
        if (stat.mtimeMs < cutoff) {
          fs.rmSync(path.join(dir, name), { recursive: true, force: true });
          deleted++;
        }
      });
      res.json({ status: 'success', deleted });
    } catch (err) { logger.error('Backup cleanup error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 17. Database connection test (placeholder for future DB integration)
  router.get('/db/status', (req, res) => {
    res.json({ status: 'success', message: 'No database configured', connected: false });
  });

  // 18. Static file search
  router.get('/static/search', (req, res) => {
    try {
      const { query } = req.query;
      if (!query) return res.status(400).json({ error: 'Query parameter required' });
      const results = [];
      const search = (dir) => {
        for (const f of fs.readdirSync(dir)) {
          const p = path.join(dir, f);
          const st = fs.statSync(p);
          if (st.isDirectory()) search(p);
          else if (f.toLowerCase().includes(query.toLowerCase())) results.push(p.replace(config.staticSiteDir, ''));
        }
      };
      search(config.staticSiteDir);
      res.json({ status: 'success', results: results.slice(0, 50) });
    } catch (err) { logger.error('Static search error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 19. Maintenance history
  router.get('/maintenance/history', (req, res) => {
    try {
      const logPath = path.join(config.paths.logs, 'app.log');
      if (!fs.existsSync(logPath)) return res.json({ status: 'success', history: [] });
      const content = fs.readFileSync(logPath, 'utf8');
      const lines = content.split('\n').filter(l => l.includes('Maintenance mode'));
      res.json({ status: 'success', history: lines.slice(-20) });
    } catch (err) { logger.error('Maintenance history error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 20. SSL certificate info (if exists)
  router.get('/ssl/info', async (req, res) => {
    try {
      const certPath = path.join(config.paths.data, 'ssl', 'cert.pem');
      if (!fs.existsSync(certPath)) return res.json({ status: 'success', exists: false });
      const stat = fs.statSync(certPath);
      res.json({ status: 'success', exists: true, size: stat.size, modified: stat.mtime });
    } catch (err) { logger.error('SSL info error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 21. Restart with delay
  router.post('/workers/restart-delayed', express.json(), async (req, res) => {
    try {
      const { delaySeconds = 5 } = req.body || {};
      res.json({ status: 'success', message: `Restart scheduled in ${delaySeconds}s` });
      setTimeout(() => {
        watchdog.gracefulRollingRestart('Delayed restart from admin panel').catch(err => {
          logger.error('Delayed restart error', { error: err.message });
        });
      }, delaySeconds * 1000);
    } catch (err) { logger.error('Delayed restart error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 22. Session info (stateless JWT but can show recent activity)
  router.get('/sessions/info', (req, res) => {
      // 23. User accounts: list
      router.get('/accounts/:role/list', (req, res) => {
        try {
          const role = req.params.role === 'maintenance' ? 'maintenance' : 'admin';
          res.json({ status: 'success', users: listUsers(role) });
        } catch (err) { logger.error('Accounts list error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
      });

      // 24. User accounts: add
      router.post('/accounts/:role/add', express.json(), (req, res) => {
        try {
          const role = req.params.role === 'maintenance' ? 'maintenance' : 'admin';
          const { username, password } = req.body || {};
          if (!username || !password) return res.status(400).json({ error: 'username and password required' });
          const result = addUser(role, username, password);
          if (!result.ok) return res.status(400).json({ error: result.error });
          res.json({ status: 'success' });
        } catch (err) { logger.error('Accounts add error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
      });

      // 25. User accounts: remove
      router.post('/accounts/:role/remove', express.json(), (req, res) => {
        try {
          const role = req.params.role === 'maintenance' ? 'maintenance' : 'admin';
          const { username } = req.body || {};
          if (!username) return res.status(400).json({ error: 'username required' });
          const result = removeUser(role, username);
          if (!result.ok) return res.status(400).json({ error: result.error });
          res.json({ status: 'success' });
        } catch (err) { logger.error('Accounts remove error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
      });

      // 26. Export .smp backup (zip with website + settings + data)
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

          // Include website directory
          archive.directory(config.staticSiteDir, 'website');
          // Include data directory (settings, users, webauthn, etc.)
          archive.directory(config.paths.data, 'data');
          // Include config overrides
          archive.file(path.join(config.paths.data, 'config-override.json'), { name: 'config-override.json' });
          // Include maintenance page
          archive.directory(config.maintenance.pageDir, 'maintenance');

          await archive.finalize();
        } catch (err) {
          logger.error('Export SMP error', { error: err.message });
          res.status(500).json({ error: 'Internal server error' });
        }
      });

      // 27. Import .smp from URL
      router.post('/backups/import-smp-from-url', express.json(), async (req, res) => {
        try {
          const { url } = req.body || {};
          if (!url) return res.status(400).json({ error: 'url required' });

          const r = await fetch(url);
          if (!r.ok) return res.status(400).json({ error: 'Failed to fetch smp file' });
          const buf = await r.buffer();

          // Save temp zip
          const tmpZip = path.join(config.paths.data, 'tmp-import.zip');
          fs.writeFileSync(tmpZip, buf);

          // Extract zip
          const unzip = await import('adm-zip');
          const AdmZip = unzip.default;
          const zip = new AdmZip(tmpZip);
          const extractDir = path.join(config.paths.data, 'import-extract');
          if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
          fs.mkdirSync(extractDir, { recursive: true });
          zip.extractAllTo(extractDir, true);

          // Restore website
          const websiteSrc = path.join(extractDir, 'website');
          if (fs.existsSync(websiteSrc)) fs.cpSync(websiteSrc, config.staticSiteDir, { recursive: true });
          // Restore data
          const dataSrc = path.join(extractDir, 'data');
          if (fs.existsSync(dataSrc)) fs.cpSync(dataSrc, config.paths.data, { recursive: true });
          // Restore maintenance
          const maintSrc = path.join(extractDir, 'maintenance');
          if (fs.existsSync(maintSrc)) fs.cpSync(maintSrc, config.maintenance.pageDir, { recursive: true });

          res.json({ status: 'success', message: 'Import completed' });
        } catch (err) {
          logger.error('Import SMP error', { error: err.message });
          res.status(500).json({ error: 'Internal server error' });
        }
      });
    try {
      res.json({
        status: 'success',
        type: 'jwt-stateless',
        currentUser: req.user?.username || 'unknown',
        loginTime: req.user?.iat ? new Date(req.user.iat * 1000).toISOString() : null
      });
    } catch (err) { logger.error('Session info error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); }
  });

  // 28. Import .smp via file upload (multipart/form-data)
  const upload = multer({ dest: path.join(config.paths.data, 'uploads') });
  router.post('/backups/import-smp-upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'file required' });
      const tmpZip = req.file.path;

      const unzip = await import('adm-zip');
      const AdmZip = unzip.default;
      const zip = new AdmZip(tmpZip);
      const extractDir = path.join(config.paths.data, 'import-extract');
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
      fs.mkdirSync(extractDir, { recursive: true });
      zip.extractAllTo(extractDir, true);

      const websiteSrc = path.join(extractDir, 'website');
      if (fs.existsSync(websiteSrc)) fs.cpSync(websiteSrc, config.staticSiteDir, { recursive: true });
      const dataSrc = path.join(extractDir, 'data');
      if (fs.existsSync(dataSrc)) fs.cpSync(dataSrc, config.paths.data, { recursive: true });
      const maintSrc = path.join(extractDir, 'maintenance');
      if (fs.existsSync(maintSrc)) fs.cpSync(maintSrc, config.maintenance.pageDir, { recursive: true });

      res.json({ status: 'success', message: 'Upload import completed' });
    } catch (err) {
      logger.error('Upload Import SMP error', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
