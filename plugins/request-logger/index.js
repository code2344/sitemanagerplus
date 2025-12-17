/**
 * Example Plugin: Request Logger
 * 
 * Logs every request with details
 */

import { Plugin } from '../../src/utils/plugin-system.js';
import logger from '../../src/utils/logger.js';

export default class RequestLoggerPlugin extends Plugin {
  constructor() {
    super('request-logger', '1.0.0');
  }

  async init() {
    logger.info('Request logger plugin initialized');
  }

  getMiddleware() {
    return [(req, res, next) => {
      const startTime = Date.now();

      res.on('finish', () => {
        const duration = Date.now() - startTime;
        logger.info(`[PLUGIN] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
      });

      next();
    }];
  }

  getRoutes() {
    return [{
      path: '/request-logger/stats',
      handler: (req, res) => {
        res.json({
          status: 'ok',
          message: 'Request logger is active',
        });
      },
    }];
  }
}
