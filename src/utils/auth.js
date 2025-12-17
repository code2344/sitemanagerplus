/**
 * Authentication & Authorization
 * 
 * Provides:
 * - Basic authentication for admin routes
 * - Role-based access control
 * - Rate limiting for sensitive endpoints
 * - Secure credential handling
 */

import config from '../utils/config.js';
import logger from '../utils/logger.js';

const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_ATTEMPTS = 10; // Max failed attempts

// Track failed login attempts by IP
const loginAttempts = new Map();

/**
 * Check rate limit for login attempts
 */
function checkRateLimit(ip) {
  const now = Date.now();
  let attempts = loginAttempts.get(ip) || [];
  
  // Clean old attempts
  attempts = attempts.filter(timestamp => (now - timestamp) < RATE_LIMIT_WINDOW);
  
  if (attempts.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    logger.warn('Rate limit exceeded for login', { ip });
    return false;
  }

  loginAttempts.set(ip, attempts);
  return true;
}

/**
 * Record failed login attempt
 */
function recordFailedAttempt(ip) {
  const attempts = loginAttempts.get(ip) || [];
  attempts.push(Date.now());
  loginAttempts.set(ip, attempts);

  if (attempts.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    logger.warn('Multiple failed login attempts', {
      ip,
      attempts: attempts.length,
    });
  }
}

/**
 * Clear rate limit for IP (successful login)
 */
function clearRateLimit(ip) {
  loginAttempts.delete(ip);
}

/**
 * Basic authentication middleware
 * Checks Authorization header with username:password in base64
 */
export function basicAuth(allowedRole = 'admin') {
  return (req, res, next) => {
    const auth = req.headers.authorization;
    const ip = req.ip;

    // Check rate limit
    if (!checkRateLimit(ip)) {
      return res.status(429).json({
        error: 'Too many login attempts. Please try again later.',
      });
    }

    // Missing auth header
    if (!auth || !auth.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="SiteManager+ Admin"');
      return res.status(401).json({ error: 'Unauthorized - missing credentials' });
    }

    try {
      // Decode base64 credentials
      const encoded = auth.slice(6);
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
      const [username, password] = decoded.split(':');

      // Get allowed credentials based on role
      let allowedUsername, allowedPassword;
      if (allowedRole === 'maintenance') {
        allowedUsername = config.maintenance.username;
        allowedPassword = config.maintenance.password;
      } else {
        allowedUsername = config.admin.username;
        allowedPassword = config.admin.password;
      }

      // Validate credentials
      // Note: In production, use bcrypt or similar for password comparison
      // For now using simple string comparison as config could be from env vars
      const credentialsValid = 
        username === allowedUsername && 
        password === allowedPassword;

      if (!credentialsValid) {
        recordFailedAttempt(ip);
        logger.warn('Failed authentication attempt', {
          ip,
          attempted_username: username,
          role: allowedRole,
        });
        return res.status(401).json({ error: 'Unauthorized - invalid credentials' });
      }

      // Success: clear rate limit and continue
      clearRateLimit(ip);
      req.user = { username, role: allowedRole };
      next();

    } catch (err) {
      logger.error('Authentication error', {
        error: err.message,
        ip,
      });
      res.status(401).json({ error: 'Unauthorized - invalid format' });
    }
  };
}

/**
 * Check if request is authenticated
 */
export function isAuthenticated(req) {
  return !!req.user;
}

/**
 * Check if request user has a specific role
 */
export function hasRole(req, role) {
  return req.user && req.user.role === role;
}

/**
 * Rate limiting middleware for sensitive endpoints
 */
export function rateLimit(windowMs = 60000, maxRequests = 100) {
  const requestCounts = new Map();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();

    let requests = requestCounts.get(key) || [];
    requests = requests.filter(timestamp => (now - timestamp) < windowMs);

    if (requests.length >= maxRequests) {
      logger.warn('Rate limit exceeded', {
        ip: key,
        windowMs,
        maxRequests,
      });
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
      });
    }

    requests.push(now);
    requestCounts.set(key, requests);

    next();
  };
}
