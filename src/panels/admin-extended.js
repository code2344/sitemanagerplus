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
import { sessionAuth } from '../utils/auth.js';
import { getMetricsCollector } from '../utils/metrics.js';
import { getAPIKeyManager } from '../utils/api-keys.js';
import { getPluginManager } from '../utils/plugin-system.js';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import * as loadTesting from '../utils/load-testing.js';
import * as feedbackManager from '../utils/feedback.js';

export function createExtendedAdminPanel(watchdog) {
  const router = express.Router();

  // All routes require admin authentication (session-aware)
  router.use(sessionAuth('admin', '/admin'));

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

  /**
   * GET /admin/feedback/list - List all feedback items
   */
  router.get('/feedback/list', (req, res) => {
    try {
      const filters = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.type) filters.type = req.query.type;
      if (req.query.page) filters.page = req.query.page;
      if (req.query.submittedBy) filters.submittedBy = req.query.submittedBy;

      const result = feedbackManager.listFeedback(filters);
      if (!result.ok) {
        return res.status(500).json({ error: result.error });
      }

      // Add screenshot data for each feedback item
      const feedbackWithScreenshots = result.feedback.map(item => ({
        ...item,
        screenshot: item.screenshotPath ? feedbackManager.getScreenshotBase64(item.screenshotPath) : null,
      }));

      res.json({
        status: 'success',
        feedback: feedbackWithScreenshots,
      });
    } catch (err) {
      logger.error('Error listing feedback', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/feedback/state - Get feedback enabled state
   */
  router.get('/feedback/state', (req, res) => {
    try {
      const enabled = feedbackManager.isFeedbackEnabled();
      res.json({
        status: 'success',
        enabled,
      });
    } catch (err) {
      logger.error('Error getting feedback state', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/feedback/toggle - Toggle feedback enabled state (admin only)
   */
  router.post('/feedback/toggle', express.json(), (req, res) => {
    try {
      // Only admins can toggle
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can toggle feedback' });
      }

      const result = feedbackManager.toggleFeedback();
      if (!result.ok) {
        return res.status(400).json({ error: result.error });
      }

      logger.info('Feedback toggled', { enabled: result.enabled, by: req.user.username });
      res.json({
        status: 'success',
        enabled: result.enabled,
      });
    } catch (err) {
      logger.error('Error toggling feedback', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /admin/feedback/:id - Get a specific feedback item
   */
  router.get('/feedback/:id', (req, res) => {
    try {
      const result = feedbackManager.getFeedback(req.params.id);
      if (!result.ok) {
        return res.status(404).json({ error: result.error });
      }

      const feedback = result.feedback;
      feedback.screenshot = feedback.screenshotPath ? feedbackManager.getScreenshotBase64(feedback.screenshotPath) : null;

      res.json({
        status: 'success',
        feedback,
      });
    } catch (err) {
      logger.error('Error getting feedback', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/feedback/submit - Create new feedback item
   */
  router.post('/feedback/submit', express.json(), (req, res) => {
    try {
      const {
        page,
        element,
        type,
        message,
        screenshot,
        username,
      } = req.body || {};

      const result = feedbackManager.createFeedback({
        page,
        element,
        type,
        message,
        screenshotBase64: screenshot,
        submittedBy: username || 'anonymous',
        submittedByRole: 'visitor',
      });

      if (!result.ok) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        status: 'success',
        id: result.id,
        feedback: result.feedback,
      });
    } catch (err) {
      logger.error('Error creating feedback', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/feedback/:id/comment - Add comment to feedback
   */
  router.post('/feedback/:id/comment', express.json(), (req, res) => {
    try {
      const { message, username } = req.body || {};

      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const result = feedbackManager.addComment(req.params.id, {
        message,
        username: username || req.user.username || 'anonymous',
        role: req.user.role || 'visitor',
      });

      if (!result.ok) {
        return res.status(404).json({ error: result.error });
      }

      res.json({
        status: 'success',
        comment: result.comment,
      });
    } catch (err) {
      logger.error('Error adding comment', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /admin/feedback/:id/resolve - Resolve feedback (admin only)
   */
  router.post('/feedback/:id/resolve', express.json(), (req, res) => {
    try {
      // Only admins can resolve
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can resolve feedback' });
      }

      const { adminNotes } = req.body || {};

      const result = feedbackManager.resolveFeedback(req.params.id, {
        resolvedBy: req.user.username,
        adminNotes,
      });

      if (!result.ok) {
        return res.status(404).json({ error: result.error });
      }

      res.json({
        status: 'success',
        feedback: result.feedback,
      });
    } catch (err) {
      logger.error('Error resolving feedback', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * DELETE /admin/feedback/:id - Delete feedback (admin only)
   */
  router.delete('/feedback/:id', (req, res) => {
    try {
      // Only admins can delete
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can delete feedback' });
      }

      const result = feedbackManager.deleteFeedback(req.params.id);
      if (!result.ok) {
        return res.status(404).json({ error: result.error });
      }

      res.json({
        status: 'success',
      });
    } catch (err) {
      logger.error('Error deleting feedback', { error: err.message });
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
