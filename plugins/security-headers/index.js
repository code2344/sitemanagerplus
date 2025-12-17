/**
 * Example Plugin: Security Headers
 * 
 * Adds security headers to all responses
 */

import { Plugin } from '../../src/utils/plugin-system.js';
import logger from '../../src/utils/logger.js';

export default class SecurityHeadersPlugin extends Plugin {
  constructor() {
    super('security-headers', '1.0.0');
  }

  async init() {
    logger.info('Security headers plugin initialized');
  }

  getMiddleware() {
    return [(req, res, next) => {
      // Content Security Policy
      res.setHeader('Content-Security-Policy', "default-src 'self'");
      
      // Prevent clickjacking
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      
      // Prevent MIME sniffing
      res.setHeader('X-Content-Type-Options', 'nosniff');
      
      // XSS protection
      res.setHeader('X-XSS-Protection', '1; mode=block');
      
      // Referrer policy
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      
      // Permissions policy
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

      next();
    }];
  }
}
