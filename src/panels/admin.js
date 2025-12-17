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
import { sessionAuth, loginHandlers } from '../utils/auth.js';
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

  return router;
}
