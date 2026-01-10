/**
 * Static File Server
 * 
 * Serves static files with:
 * - Intelligent caching headers
 * - Compression support
 * - Path traversal protection
 * - Graceful 404 handling without crashes
 * - Content type detection
 */

import express from 'express';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import config from '../utils/config.js';
import * as feedbackManager from '../utils/feedback.js';

// Read the auto-reload script once at startup
let autoReloadScript = '';
try {
  autoReloadScript = fs.readFileSync(path.join(config.paths.src, 'cluster', 'auto-reload.js'), 'utf8');
} catch (err) {
  logger.warn('Failed to load auto-reload script', { error: err.message });
}

/**
 * Create static file server middleware
 */
export function createStaticServer() {
  const router = express.Router();
  const staticDir = config.staticSiteDir;

  // Enable compression for all responses
  router.use(compression({
    level: 6,
    threshold: 1024, // Only compress responses > 1KB
    filter: (req, res) => {
      // Don't compress images or already-compressed content
      const type = res.getHeader('content-type') || '';
      if (type.includes('image') || type.includes('video') || type.includes('font')) {
        return false;
      }
      return compression.filter(req, res);
    }
  }));

  /**
   * Serve feedback widget script when enabled
   */
  router.get('/feedback-widget.js', (req, res) => {
    // Check if feedback is enabled
    if (!feedbackManager.isFeedbackEnabled()) {
      return res.status(404).json({ error: 'Not found' });
    }

    try {
      const widgetPath = path.join(config.paths.src, '..', 'website', 'feedback-widget.js');
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      // Avoid long-lived caching so updates to the widget are picked up immediately
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(widgetPath);
    } catch (err) {
      logger.error('Error serving feedback widget', { error: err.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Serve static files with proper headers
   */
  router.use((req, res, next) => {
    // Resolve the file path safely (prevent directory traversal)
    try {
      const requestedPath = decodeURIComponent(req.path || '/');
      // Use path.resolve with a prefixed dot so leading slashes do not escape staticDir
      const normalizedPath = path.resolve(staticDir, '.' + requestedPath);
      const staticRoot = path.normalize(staticDir + path.sep);
      const normalizedRoot = path.normalize(staticDir);

      // Ensure the path is within staticDir
      if (!normalizedPath.startsWith(staticRoot) && normalizedPath !== normalizedRoot) {
        logger.warn('Path traversal attempt blocked', {
          originalPath: req.path,
          attemptedPath: normalizedPath,
          ip: req.ip,
        });
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Try to serve the file
      fs.stat(normalizedPath, (err, stats) => {
        if (err) {
          // File not found, try index.html in directory
          if (err.code === 'ENOENT' && req.path.endsWith('/')) {
            const indexPath = path.join(normalizedPath, 'index.html');
            return fs.stat(indexPath, (indexErr, indexStats) => {
              if (!indexErr && indexStats.isFile()) {
                return serveFile(indexPath, req, res);
              }
              // Neither file nor index.html found
              return res.status(404).json({ error: 'Not found' });
            });
          }

          // Try appending .html
          if (!normalizedPath.endsWith('.html')) {
            const htmlPath = normalizedPath + '.html';
            return fs.stat(htmlPath, (htmlErr, htmlStats) => {
              if (!htmlErr && htmlStats.isFile()) {
                return serveFile(htmlPath, req, res);
              }
              return res.status(404).json({ error: 'Not found' });
            });
          }

          logger.debug('File not found', { path: req.path });
          return res.status(404).json({ error: 'Not found' });
        }

        // If it's a directory, try index.html
        if (stats.isDirectory()) {
          const indexPath = path.join(normalizedPath, 'index.html');
          return fs.stat(indexPath, (indexErr, indexStats) => {
            if (!indexErr && indexStats.isFile()) {
              return serveFile(indexPath, req, res);
            }
            return res.status(404).json({ error: 'Not found' });
          });
        }

        // Serve the file
        serveFile(normalizedPath, req, res);
      });
    } catch (err) {
      logger.error('Error in static file server', {
        path: req.path,
        error: err.message,
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Helper: Serve a file with appropriate headers
   */
  function serveFile(filePath, req, res) {
    try {
      fs.stat(filePath, (err, stats) => {
        if (err) {
          return res.status(404).json({ error: 'Not found' });
        }

        // Set caching headers based on file type
        const ext = path.extname(filePath).toLowerCase();
        
        // Static assets: cache for 1 year
        if (['.js', '.css', '.woff', '.woff2', '.ttf', '.eot', '.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
        // HTML files: don't cache (or use ETags)
        else if (ext === '.html') {
          res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
          // Send ETag so browser can validate
          res.setHeader('ETag', `"${stats.mtime.getTime()}"`);
        }
        // Default: 1 day
        else {
          res.setHeader('Cache-Control', 'public, max-age=86400');
        }

        // Set content type
        const contentType = getContentType(ext);
        res.setHeader('Content-Type', contentType);
        
        // Security headers
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('X-XSS-Protection', '1; mode=block');

        // Inject scripts into HTML files (auto-reload + feedback widget)
        if (ext === '.html') {
          fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
              return res.status(500).json({ error: 'Internal server error' });
            }

            let injected = data;

            if (autoReloadScript) {
              injected = injected.replace(
                '</body>',
                `<script>${autoReloadScript}</script>\n</body>`
              );
            }

            if (feedbackManager.isFeedbackEnabled()) {
              const feedbackWidgetScript = '<script src="/feedback-widget.js"></script>';
              injected = injected.replace(
                '</body>',
                feedbackWidgetScript + '\n</body>'
              );
            }

            res.send(injected);
          });
        } else {
          // Send file normally
          res.sendFile(filePath);
        }
      });
    } catch (err) {
      logger.error('Error serving file', {
        path: filePath,
        error: err.message,
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  return router;
}

/**
 * Determine content type from file extension
 */
function getContentType(ext) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.txt': 'text/plain; charset=utf-8',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  };

  return types[ext] || 'application/octet-stream';
}
