/**
 * API Key Management System
 * 
 * Provides token-based authentication as alternative to Basic Auth
 * - Generate, store, and rotate API keys
 * - Scoped permissions
 * - Rate limiting per key
 * - Audit logging
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from './config.js';
import logger from './logger.js';

const API_KEYS_FILE = path.join(config.paths.data, 'api-keys.json');

/**
 * API Key Manager
 */
export class APIKeyManager {
  constructor() {
    this.keys = new Map();
    this.rateLimitTrackers = new Map();
    this.loadKeys();
  }

  /**
   * Load API keys from disk
   */
  loadKeys() {
    try {
      if (fs.existsSync(API_KEYS_FILE)) {
        const data = fs.readFileSync(API_KEYS_FILE, 'utf8');
        const keys = JSON.parse(data);
        
        for (const key of keys) {
          this.keys.set(key.id, key);
        }

        logger.info(`Loaded ${keys.length} API keys`);
      }
    } catch (err) {
      logger.warn('Failed to load API keys', { error: err.message });
    }
  }

  /**
   * Save API keys to disk
   */
  saveKeys() {
    try {
      const keys = Array.from(this.keys.values());
      fs.writeFileSync(API_KEYS_FILE, JSON.stringify(keys, null, 2), 'utf8');
    } catch (err) {
      logger.error('Failed to save API keys', { error: err.message });
    }
  }

  /**
   * Generate new API key
   */
  generateKey(name, scopes = ['read', 'write'], expiresInDays = null) {
    const id = crypto.randomBytes(16).toString('hex');
    const secret = crypto.randomBytes(32).toString('hex');
    const key = `sm_${id}.${secret}`;

    const apiKey = {
      id,
      name,
      secret,
      scopes,
      createdAt: new Date().toISOString(),
      expiresAt: expiresInDays 
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null,
      lastUsed: null,
      rateLimit: 1000, // requests per minute
      active: true,
    };

    this.keys.set(id, apiKey);
    this.saveKeys();

    logger.info('API key generated', { name, id });

    // Return full key only once
    return { key, ...apiKey };
  }

  /**
   * Validate API key
   */
  validateKey(keyString) {
    if (!keyString || !keyString.startsWith('sm_')) {
      return null;
    }

    const parts = keyString.slice(3).split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [id, secret] = parts;
    const apiKey = this.keys.get(id);

    if (!apiKey) {
      return null;
    }

    // Check if expired
    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      logger.warn('API key expired', { id });
      return null;
    }

    // Check if active
    if (!apiKey.active) {
      logger.warn('API key inactive', { id });
      return null;
    }

    // Validate secret (constant-time comparison)
    if (!crypto.timingSafeEqual(Buffer.from(apiKey.secret), Buffer.from(secret))) {
      logger.warn('API key validation failed', { id });
      return null;
    }

    // Check rate limit
    if (!this.checkRateLimit(id, apiKey.rateLimit)) {
      logger.warn('API key rate limit exceeded', { id });
      return null;
    }

    // Update last used
    apiKey.lastUsed = new Date().toISOString();
    this.saveKeys();

    return apiKey;
  }

  /**
   * Check rate limit for key
   */
  checkRateLimit(keyId, limit) {
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window

    if (!this.rateLimitTrackers.has(keyId)) {
      this.rateLimitTrackers.set(keyId, []);
    }

    const tracker = this.rateLimitTrackers.get(keyId);
    const recentRequests = tracker.filter(timestamp => timestamp > windowStart);

    if (recentRequests.length >= limit) {
      return false;
    }

    recentRequests.push(now);
    this.rateLimitTrackers.set(keyId, recentRequests);

    return true;
  }

  /**
   * Revoke API key
   */
  revokeKey(id) {
    const apiKey = this.keys.get(id);
    if (!apiKey) {
      return false;
    }

    apiKey.active = false;
    this.saveKeys();
    logger.info('API key revoked', { id, name: apiKey.name });

    return true;
  }

  /**
   * List all API keys (public info only)
   */
  listKeys() {
    const keys = [];
    for (const key of this.keys.values()) {
      keys.push({
        id: key.id,
        name: key.name,
        scopes: key.scopes,
        active: key.active,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt,
        lastUsed: key.lastUsed,
      });
    }
    return keys;
  }

  /**
   * Get key by ID
   */
  getKey(id) {
    const key = this.keys.get(id);
    if (!key) return null;

    return {
      id: key.id,
      name: key.name,
      scopes: key.scopes,
      active: key.active,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      lastUsed: key.lastUsed,
    };
  }
}

// Singleton instance
let apiKeyManager = null;

/**
 * Get or create API key manager
 */
export function getAPIKeyManager() {
  if (!apiKeyManager) {
    apiKeyManager = new APIKeyManager();
  }
  return apiKeyManager;
}

/**
 * Middleware: Validate API key from Authorization header
 */
export function validateAPIKey(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(); // Not an API key auth, continue
  }

  const keyString = authHeader.slice(7);
  const manager = getAPIKeyManager();
  const apiKey = manager.validateKey(keyString);

  if (!apiKey) {
    return res.status(401).json({ error: 'Invalid or expired API key' });
  }

  req.apiKey = apiKey;
  req.user = { 
    type: 'api_key',
    id: apiKey.id,
    name: apiKey.name,
    scopes: apiKey.scopes,
  };

  next();
}

/**
 * Require specific scope
 */
export function requireScope(scope) {
  return (req, res, next) => {
    if (!req.user || !req.user.scopes || !req.user.scopes.includes(scope)) {
      return res.status(403).json({ error: `Requires '${scope}' scope` });
    }
    next();
  };
}
