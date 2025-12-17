/**
 * Extended Admin Panel Routes
 * 
 * Additional admin endpoints for:
 * - Metrics and monitoring
 * - API key management
 * - Plugin management
 * - Load testing (dev only)
 * - Advanced diagnostics
 */

import express from 'express';
import { basicAuth, requireAPIKeyOrAuth } from '../utils/auth.js';
import { getMetricsCollector } from '../utils/metrics.js';
import { getAPIKeyManager } from '../utils/api-keys.js';
import { getPluginManager } from '../utils/plugin-system.js';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import * as loadTesting from '../utils/load-testing.js';

export function createExtendedAdminPanel(watchdog) {
  const router = express.Router();

  // All routes require admin authentication
  router.use(basicAuth('admin'));

  /**
   * GET /admin/metrics - Prometheus metrics format
   */
  router.get('/metrics', (req, res) => {
    try {
      const metrics = getMetricsCollector();
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(metrics.getPrometheusMetrics());
    } catch (err) {
      logger.error('Error getting metrics', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/metrics/summary - Metrics summary
   */
  router.get('/metrics/summary', (req, res) => {
    try {
      const metrics = getMetricsCollector();
      res.json({
        status: 'success',
        metrics: metrics.getSummary(),
      });
    } catch (err) {
      logger.error('Error getting metrics summary', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/api-keys - List API keys
   */
  router.get('/api-keys', (req, res) => {
    try {
      const manager = getAPIKeyManager();
      res.json({
        status: 'success',
        keys: manager.listKeys(),
      });
    } catch (err) {
      logger.error('Error listing API keys', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/api-keys/generate - Generate new API key
   */
  router.post('/api-keys/generate', express.json(), (req, res) => {
    try {
      const { name = 'api-key', scopes = ['read', 'write'], expiresInDays } = req.body || {};
      const manager = getAPIKeyManager();
      
      const newKey = manager.generateKey(name, scopes, expiresInDays);

      logger.info('API key generated via admin', {
        name,
        user: req.user.username,
      });

      res.json({
        status: 'success',
        key: newKey,
        warning: 'Save this key securely - it cannot be recovered!',
      });
    } catch (err) {
      logger.error('Error generating API key', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/api-keys/:id/revoke - Revoke API key
   */
  router.post('/api-keys/:id/revoke', (req, res) => {
    try {
      const { id } = req.params;
      const manager = getAPIKeyManager();

      const success = manager.revokeKey(id);
      if (!success) {
        return res.status(404).json({ error: 'API key not found' });
      }

      logger.info('API key revoked via admin', {
        keyId: id,
        user: req.user.username,
      });

      res.json({
        status: 'success',
        message: 'API key revoked',
      });
    } catch (err) {
      logger.error('Error revoking API key', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/plugins - List plugins
   */
  router.get('/plugins', (req, res) => {
    try {
      const manager = getPluginManager();
      res.json({
        status: 'success',
        plugins: manager.listPlugins(),
      });
    } catch (err) {
      logger.error('Error listing plugins', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/plugins/:name/toggle - Enable/disable plugin
   */
  router.post('/plugins/:name/toggle', (req, res) => {
    try {
      const { name } = req.params;
      const manager = getPluginManager();
      const plugin = manager.getPlugin(name);

      if (!plugin) {
        return res.status(404).json({ error: 'Plugin not found' });
      }

      const newState = !plugin.enabled;
      manager.setEnabled(name, newState);

      logger.info('Plugin toggled via admin', {
        plugin: name,
        enabled: newState,
        user: req.user.username,
      });

      res.json({
        status: 'success',
        plugin: name,
        enabled: newState,
      });
    } catch (err) {
      logger.error('Error toggling plugin', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Load testing endpoints (dev only)
  if (config.nodeEnv === 'development') {
    /**
     * POST /admin/load-test - Run load test
     */
    router.post('/load-test', express.json(), async (req, res) => {
      try {
        const { duration = 5000, concurrency = 10 } = req.body || {};

        logger.warn('Load test initiated via admin', {
          duration,
          concurrency,
          user: req.user.username,
        });

        const results = await loadTesting.simulateLoad(duration, concurrency);

        res.json({
          status: 'success',
          results: loadTesting.getLoadTestSummary(results),
        });
      } catch (err) {
        logger.error('Error running load test', { error: err.message });
        res.status(500).json({ error: err.message });
      }
    });

    /**
     * POST /admin/simulate/crash - Simulate worker crash (dev only)
     */
    router.post('/simulate/crash', (req, res) => {
      logger.warn('Simulating crash via admin', { user: req.user.username });
      res.json({ status: 'success', message: 'Worker will crash shortly' });
      
      setTimeout(() => {
        loadTesting.simulateCrash();
      }, 500);
    });

    /**
     * POST /admin/simulate/memory - Simulate high memory (dev only)
     */
    router.post('/simulate/memory', express.json(), async (req, res) => {
      try {
        const { sizeGB = 0.5, duration = 10000 } = req.body || {};

        logger.warn('Memory simulation initiated', { sizeGB, duration });

        res.json({ status: 'success', message: 'Memory simulation started' });

        await loadTesting.simulateHighMemory(sizeGB, duration);
      } catch (err) {
        logger.error('Memory simulation error', { error: err.message });
      }
    });

    /**
     * POST /admin/simulate/lag - Simulate event loop lag (dev only)
     */
    router.post('/simulate/lag', express.json(), (req, res) => {
      const { duration = 5000 } = req.body || {};

      logger.warn('Event loop lag simulation initiated', { duration });

      res.json({ status: 'success', message: 'Event loop lag simulation started' });

      loadTesting.simulateEventLoopLag(duration);
    });
  }

  return router;
}
