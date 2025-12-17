/**
 * Plugin System
 * 
 * Extensibility through plugins:
 * - Custom middleware
 * - Custom routes
 * - Custom health checks
 * - Custom alert handlers
 */

import fs from 'fs';
import path from 'path';
import config from '../utils/config.js';
import logger from '../utils/logger.js';

/**
 * Plugin interface
 */
export class Plugin {
  constructor(name, version = '1.0.0') {
    this.name = name;
    this.version = version;
    this.enabled = true;
  }

  /**
   * Initialize plugin
   */
  async init() {
    // Override in subclass
  }

  /**
   * Get middleware (optional)
   */
  getMiddleware() {
    return [];
  }

  /**
   * Get routes (optional)
   */
  getRoutes() {
    return [];
  }

  /**
   * Get health checks (optional)
   */
  getHealthChecks() {
    return [];
  }

  /**
   * Cleanup on shutdown
   */
  async cleanup() {
    // Override in subclass
  }
}

/**
 * Plugin Manager
 */
export class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.pluginDir = path.join(config.paths.root, 'plugins');
  }

  /**
   * Load all plugins from plugins directory
   */
  async loadPlugins() {
    if (!fs.existsSync(this.pluginDir)) {
      logger.debug('No plugins directory found');
      return;
    }

    try {
      const entries = fs.readdirSync(this.pluginDir);

      for (const entry of entries) {
        const pluginPath = path.join(this.pluginDir, entry);
        const stat = fs.statSync(pluginPath);

        if (!stat.isDirectory()) continue;

        const indexFile = path.join(pluginPath, 'index.js');
        if (!fs.existsSync(indexFile)) {
          logger.warn('Plugin missing index.js', { plugin: entry });
          continue;
        }

        try {
          await this.loadPlugin(entry, indexFile);
        } catch (err) {
          logger.error('Failed to load plugin', {
            plugin: entry,
            error: err.message,
          });
        }
      }

      logger.info(`Loaded ${this.plugins.size} plugins`);
    } catch (err) {
      logger.error('Error loading plugins', { error: err.message });
    }
  }

  /**
   * Load individual plugin
   */
  async loadPlugin(name, filePath) {
    try {
      // Dynamic import
      const module = await import(`file://${filePath}`);
      const PluginClass = module.default;

      if (!PluginClass || !PluginClass.prototype instanceof Plugin) {
        throw new Error('Plugin must export default class extending Plugin');
      }

      const plugin = new PluginClass();
      await plugin.init();

      this.plugins.set(name, plugin);

      logger.info('Plugin loaded', {
        name,
        version: plugin.version,
      });
    } catch (err) {
      throw new Error(`Failed to load plugin ${name}: ${err.message}`);
    }
  }

  /**
   * Register plugin manually
   */
  registerPlugin(name, plugin) {
    this.plugins.set(name, plugin);
    logger.info('Plugin registered', { name });
  }

  /**
   * Get all middleware from plugins
   */
  getMiddleware() {
    const middleware = [];
    for (const plugin of this.plugins.values()) {
      if (!plugin.enabled) continue;
      middleware.push(...(plugin.getMiddleware() || []));
    }
    return middleware;
  }

  /**
   * Get all routes from plugins
   */
  getRoutes() {
    const routes = [];
    for (const plugin of this.plugins.values()) {
      if (!plugin.enabled) continue;
      routes.push(...(plugin.getRoutes() || []));
    }
    return routes;
  }

  /**
   * Get all health checks from plugins
   */
  getHealthChecks() {
    const checks = [];
    for (const plugin of this.plugins.values()) {
      if (!plugin.enabled) continue;
      checks.push(...(plugin.getHealthChecks() || []));
    }
    return checks;
  }

  /**
   * Enable/disable plugin
   */
  setEnabled(name, enabled) {
    const plugin = this.plugins.get(name);
    if (plugin) {
      plugin.enabled = enabled;
      logger.info('Plugin enabled/disabled', { name, enabled });
    }
  }

  /**
   * Get plugin
   */
  getPlugin(name) {
    return this.plugins.get(name);
  }

  /**
   * List all plugins
   */
  listPlugins() {
    const list = [];
    for (const [name, plugin] of this.plugins.entries()) {
      list.push({
        name,
        version: plugin.version,
        enabled: plugin.enabled,
      });
    }
    return list;
  }

  /**
   * Cleanup all plugins
   */
  async cleanup() {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.cleanup();
      } catch (err) {
        logger.error('Error cleaning up plugin', {
          plugin: plugin.name,
          error: err.message,
        });
      }
    }
  }
}

// Singleton instance
let pluginManager = null;

/**
 * Get or create plugin manager
 */
export function getPluginManager() {
  if (!pluginManager) {
    pluginManager = new PluginManager();
  }
  return pluginManager;
}
