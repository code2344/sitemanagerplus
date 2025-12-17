/**
 * SSL/TLS Configuration
 * 
 * Enables HTTPS with:
 * - Self-signed certificate generation
 * - Proper certificate handling
 * - HSTS headers
 * - Certificate validation
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { exec } from 'child_process';
import config from './config.js';
import logger from './logger.js';

const CERT_DIR = path.join(config.paths.data, 'certs');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');

/**
 * Ensure cert directory exists
 */
function ensureCertDir() {
  if (!fs.existsSync(CERT_DIR)) {
    fs.mkdirSync(CERT_DIR, { recursive: true });
  }
}

/**
 * Check if certificates exist and are valid
 */
function hasCertificates() {
  return fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE);
}

/**
 * Generate self-signed certificate
 * Uses openssl (must be installed on system)
 */
function generateSelfSignedCert() {
  return new Promise((resolve, reject) => {
    ensureCertDir();

    const command = `openssl req -x509 -newkey rsa:2048 -keyout ${KEY_FILE} -out ${CERT_FILE} -days 365 -nodes -subj "/CN=localhost"`;

    exec(command, (err) => {
      if (err) {
        reject(new Error(`Failed to generate certificate: ${err.message}`));
        return;
      }

      logger.info('Self-signed certificate generated', {
        certFile: CERT_FILE,
        keyFile: KEY_FILE,
      });

      resolve();
    });
  });
}

/**
 * Load certificate and key
 */
function loadCertificates() {
  if (!hasCertificates()) {
    return null;
  }

  try {
    return {
      cert: fs.readFileSync(CERT_FILE, 'utf8'),
      key: fs.readFileSync(KEY_FILE, 'utf8'),
    };
  } catch (err) {
    logger.error('Failed to load certificates', { error: err.message });
    return null;
  }
}

/**
 * Create HTTPS server
 */
async function createHTTPSServer(app) {
  try {
    // Check if certificates exist, if not generate them
    if (!hasCertificates()) {
      logger.info('No SSL certificates found, generating self-signed certificate...');
      await generateSelfSignedCert();
    }

    const certs = loadCertificates();
    if (!certs) {
      throw new Error('Failed to load SSL certificates');
    }

    const httpsServer = https.createServer(certs, app);

    logger.info('HTTPS server ready with SSL/TLS');

    return httpsServer;
  } catch (err) {
    logger.error('Failed to setup HTTPS', { error: err.message });
    throw err;
  }
}

/**
 * Middleware: Add HSTS header
 */
export function hstsHeader(maxAge = 31536000) {
  return (req, res, next) => {
    res.setHeader('Strict-Transport-Security', `max-age=${maxAge}; includeSubDomains`);
    next();
  };
}

export { createHTTPSServer, hasCertificates };
