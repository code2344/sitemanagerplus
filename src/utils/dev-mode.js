/**
 * Development Mode Utilities
 * 
 * Enables development-specific features:
 * - Auto-reload on code changes
 * - Detailed request logging
 * - Error stack traces in responses
 * - Development console utilities
 */

import config from './config.js';
import logger from './logger.js';

/**
 * Check if in development mode
 */
export function isDevelopment() {
  return config.nodeEnv === 'development';
}

/**
 * Middleware: Development mode handlers
 */
export function developmentMiddleware(req, res, next) {
  if (!isDevelopment()) {
    return next();
  }

  // Disable caching in development
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Detailed request logging
  logger.debug('Development request', {
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
  });

  // Add development info to response headers
  res.setHeader('X-Dev-Mode', 'true');

  next();
}

/**
 * Middleware: Enhanced error handling for development
 */
export function developmentErrorHandler(err, req, res, next) {
  if (!isDevelopment()) {
    return next(err);
  }

  logger.error('Development error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
  });

  res.status(500).json({
    error: err.message,
    stack: err.stack?.split('\n'),
    development: true,
  });
}

/**
 * Development console
 */
export const devConsole = {
  /**
   * Log development message
   */
  log(...args) {
    if (isDevelopment()) {
      console.log('[DEV]', ...args);
    }
  },

  /**
   * Log warning
   */
  warn(...args) {
    if (isDevelopment()) {
      console.warn('[DEV WARN]', ...args);
    }
  },

  /**
   * Log error
   */
  error(...args) {
    if (isDevelopment()) {
      console.error('[DEV ERROR]', ...args);
    }
  },

  /**
   * Log request
   */
  logRequest(method, path, statusCode, duration) {
    if (isDevelopment()) {
      console.log(`[DEV] ${method} ${path} -> ${statusCode} (${duration}ms)`);
    }
  },
};
