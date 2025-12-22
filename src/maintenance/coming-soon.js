/**
 * Coming Soon Mode System
 * 
 * Similar to maintenance but shows "coming soon" instead of "under maintenance"
 * Used while site is still being built but accessible internally
 */

import fs from 'fs';
import path from 'path';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { EventEmitter } from 'events';

const DEFAULT_COMING_SOON_STATE = {
  enabled: false,
  startedAt: null,
  triggeredBy: 'admin',
};

export class ComingSoonManager extends EventEmitter {
  constructor() {
    super();
    this.stateFile = path.join(config.paths.data, 'coming-soon-state.json');
    this.state = { ...DEFAULT_COMING_SOON_STATE };
    this.pageCache = null;
    this.loadState();
    this.loadPage();
  }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = fs.readFileSync(this.stateFile, 'utf8');
        const loaded = JSON.parse(data);
        this.state = { ...DEFAULT_COMING_SOON_STATE, ...loaded };
        logger.info('Coming soon state loaded', { enabled: this.state.enabled });
      } else {
        this.state = { ...DEFAULT_COMING_SOON_STATE };
      }
    } catch (err) {
      logger.error('Failed to load coming soon state', { error: err.message });
      this.state = { ...DEFAULT_COMING_SOON_STATE };
    }
  }

  saveState() {
    try {
      const dir = path.dirname(this.stateFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      logger.error('Failed to save coming soon state', { error: err.message });
    }
  }

  loadPage() {
    try {
      const pagePath = path.join(config.paths.data, 'coming-soon.html');
      if (fs.existsSync(pagePath)) {
        this.pageCache = fs.readFileSync(pagePath, 'utf8');
      } else {
        this.pageCache = this.getDefaultPage();
      }
    } catch (err) {
      logger.error('Failed to load coming soon page', { error: err.message });
      this.pageCache = this.getDefaultPage();
    }
  }

  getDefaultPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Coming Soon</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; }
    .container { text-align: center; max-width: 600px; }
    h1 { font-size: 48px; margin: 0 0 12px; }
    p { font-size: 20px; margin: 0 0 32px; opacity: 0.9; }
    .dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: currentColor; margin: 0 6px; animation: pulse 1.4s ease-in-out infinite; }
    .dot:nth-child(1) { animation-delay: 0s; }
    .dot:nth-child(2) { animation-delay: 0.2s; }
    .dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Coming Soon</h1>
    <p>We're building something great. Stay tuned!</p>
    <p><span class="dot"></span><span class="dot"></span><span class="dot"></span></p>
  </div>
</body>
</html>`;
  }

  getState() {
    return { ...this.state };
  }

  enable() {
    this.state.enabled = true;
    this.state.startedAt = new Date().toISOString();
    this.saveState();
    this.emit('enabled');
    logger.info('Coming soon mode enabled');
  }

  disable() {
    this.state.enabled = false;
    this.saveState();
    this.emit('disabled');
    logger.info('Coming soon mode disabled');
  }

  getPage() {
    return this.pageCache;
  }

  reloadPage() {
    logger.info('Reloading coming soon page...');
    this.loadPage();
  }
}

let comingSoonManager = null;

export function getComingSoonManager() {
  if (!comingSoonManager) {
    comingSoonManager = new ComingSoonManager();
  }
  return comingSoonManager;
}
