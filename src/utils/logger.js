/**
 * Logging System
 * 
 * Production-grade logging with:
 * - Structured log output with timestamps
 * - File and console output
 * - Process ID tracking for cluster debugging
 * - Never crashes even if log writes fail
 */

import fs from 'fs';
import path from 'path';
import config from './config.js';

// Create logs directory if it doesn't exist
const logDir = config.paths.logs;
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const LOG_LEVELS = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
};

/**
 * Format log message with timestamp and level
 */
function formatLogMessage(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const pid = process.pid;
  const dataStr = Object.keys(data).length > 0 ? ` | ${JSON.stringify(data)}` : '';
  return `[${timestamp}] [${level}] [PID:${pid}] ${message}${dataStr}\n`;
}

/**
 * Safely write to log file without crashing if it fails
 */
function safeLogToFile(logMessage, filename) {
  try {
    const logPath = path.join(logDir, filename);
    fs.appendFileSync(logPath, logMessage, { encoding: 'utf8' });
  } catch (err) {
    // If we can't write to file, at least log to console
    // but NEVER crash the process
    console.error('Failed to write to log file:', err.message);
  }
}

/**
 * Determine whether to also write to console.
 * If CLI is active (sentinel file exists) or NO_CONSOLE_LOG is set, suppress console output.
 */
function shouldWriteConsole() {
  try {
    if (process.env.NO_CONSOLE_LOG === '1') return false;
    const sentinel = path.join(logDir, '.cli-active');
    return !fs.existsSync(sentinel);
  } catch {
    return true;
  }
}

/**
 * Logger object with methods for each log level
 * Writes to file always; writes to console only when allowed by shouldWriteConsole().
 */
const logger = {
  error(message, data = {}) {
    const logMessage = formatLogMessage(LOG_LEVELS.ERROR, message, data);
    if (shouldWriteConsole()) console.error(logMessage.trim());
    safeLogToFile(logMessage, 'error.log');
  },

  warn(message, data = {}) {
    const logMessage = formatLogMessage(LOG_LEVELS.WARN, message, data);
    if (shouldWriteConsole()) console.warn(logMessage.trim());
    safeLogToFile(logMessage, 'app.log');
  },

  info(message, data = {}) {
    const logMessage = formatLogMessage(LOG_LEVELS.INFO, message, data);
    if (shouldWriteConsole()) console.log(logMessage.trim());
    safeLogToFile(logMessage, 'app.log');
  },

  debug(message, data = {}) {
    if (config.nodeEnv !== 'production') {
      const logMessage = formatLogMessage(LOG_LEVELS.DEBUG, message, data);
      if (shouldWriteConsole()) console.log(logMessage.trim());
      safeLogToFile(logMessage, 'debug.log');
    }
  },

  /**
   * Log HTTP request in a structured format
   */
  httpRequest(method, url, statusCode, responseTime, data = {}) {
    const logMessage = formatLogMessage(
      'HTTP',
      `${method} ${url} -> ${statusCode}ms:${responseTime}ms`,
      data
    );
    safeLogToFile(logMessage, 'http.log');
  },
};

export default logger;
