#!/usr/bin/env node

/**
 * SiteManager+ CLI Tool
 * 
 * Command-line interface for managing SiteManager+ server
 * 
 * Usage:
 *   sitemanager status           - Show server status
 *   sitemanager restart          - Trigger rolling restart
 *   sitemanager logs [lines]     - Show recent logs
 *   sitemanager maintenance on/off - Toggle maintenance mode
 *   sitemanager api-keys         - Manage API keys
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const DEFAULT_HOST = 'http://localhost:3000';
const CREDENTIALS_FILE = path.join(process.env.HOME, '.sitemanager-creds');

// Color codes
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

/**
 * Print colored output
 */
function print(color, text) {
  console.log(`${COLORS[color]}${text}${COLORS.reset}`);
}

/**
 * Get stored credentials
 */
function getStoredCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const data = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    // Ignore errors, return null
  }
  return null;
}

/**
 * Store credentials
 */
function storeCredentials(username, password, role = 'admin') {
  try {
    const creds = {
      username,
      password,
      role,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds), 'utf8');
    fs.chmodSync(CREDENTIALS_FILE, 0o600); // Only readable by user
  } catch (err) {
    console.error('Failed to store credentials:', err.message);
  }
}

/**
 * Prompt for credentials
 */
async function promptCredentials(role = 'admin') {
  const stored = getStoredCredentials();
  
  if (stored && stored.role === role) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(
        `Use stored ${role} credentials? (y/n) `,
        (answer) => {
          rl.close();
          if (answer.toLowerCase() === 'y') {
            return resolve(stored);
          }

          promptNew(role).then(resolve);
        }
      );
    });
  }

  return promptNew(role);
}

/**
 * Prompt for new credentials
 */
async function promptNew(role) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${role} username: `, (username) => {
      rl.question(`${role} password: `, (password) => {
        rl.close();
        
        // Ask to save
        const rl2 = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        rl2.question('Save credentials? (y/n) ', (answer) => {
          rl2.close();
          if (answer.toLowerCase() === 'y') {
            storeCredentials(username, password, role);
          }

          resolve({ username, password, role });
        });
      });
    });
  });
}

/**
 * Make API request with auth
 */
async function apiRequest(endpoint, options = {}, credentials = null) {
  const url = `${DEFAULT_HOST}${endpoint}`;
  
  const fetchOptions = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  };

  // Add authentication
  if (credentials) {
    const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
    fetchOptions.headers.Authorization = `Basic ${auth}`;
  } else if (process.env.SITEMANAGER_API_KEY) {
    fetchOptions.headers.Authorization = `Bearer ${process.env.SITEMANAGER_API_KEY}`;
  }

  try {
    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data;
  } catch (err) {
    throw new Error(`API request failed: ${err.message}`);
  }
}

/**
 * Command: status
 */
async function cmdStatus() {
  try {
    const creds = await promptCredentials('admin');
    const response = await apiRequest('/admin/status', {}, creds);

    print('green', '✓ Server Status');
    console.log(JSON.stringify(response.system, null, 2));
  } catch (err) {
    print('red', `✗ Error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Command: logs
 */
async function cmdLogs(lines = 50) {
  try {
    const creds = await promptCredentials('admin');
    const response = await apiRequest('/admin/logs', {
      method: 'POST',
      body: JSON.stringify({ logFile: 'app.log', lines: parseInt(lines, 10) }),
    }, creds);

    print('cyan', '📋 Recent Logs:');
    console.log(response.logs);
  } catch (err) {
    print('red', `✗ Error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Command: restart
 */
async function cmdRestart(type = 'rolling') {
  try {
    const creds = await promptCredentials('ops');
    
    if (type === 'rolling') {
      print('yellow', '⟳ Triggering rolling restart...');
      const response = await apiRequest('/maintenance/restart/rolling', {
        method: 'POST',
        body: JSON.stringify({ reason: 'CLI-initiated restart' }),
      }, creds);

      print('green', '✓ Rolling restart initiated');
      console.log(response);
    }
  } catch (err) {
    print('red', `✗ Error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Command: maintenance
 */
async function cmdMaintenance(action) {
  try {
    const creds = await promptCredentials('admin');

    if (action === 'on') {
      print('yellow', '🔧 Enabling maintenance mode...');
      const response = await apiRequest('/admin/maintenance/enable', {
        method: 'POST',
        body: JSON.stringify({ reason: 'CLI-initiated maintenance' }),
      }, creds);

      print('green', '✓ Maintenance mode enabled');
      console.log(response.maintenance);
    } else if (action === 'off') {
      print('yellow', '🔧 Disabling maintenance mode...');
      const response = await apiRequest('/admin/maintenance/disable', {
        method: 'POST',
      }, creds);

      print('green', '✓ Maintenance mode disabled');
      console.log(response.maintenance);
    } else {
      print('red', 'Usage: sitemanager maintenance on|off');
      process.exit(1);
    }
  } catch (err) {
    print('red', `✗ Error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Command: api-keys
 */
async function cmdAPIKeys(subcommand, ...args) {
  try {
    const creds = await promptCredentials('admin');

    if (subcommand === 'list') {
      const response = await apiRequest('/admin/api-keys', {}, creds);
      print('green', '✓ API Keys:');
      console.table(response.keys);
    } else if (subcommand === 'generate') {
      const name = args[0] || 'new-key';
      const response = await apiRequest('/admin/api-keys/generate', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }, creds);

      print('green', '✓ API Key generated:');
      print('bright', response.key);
      console.log('Save this key securely - it cannot be recovered!');
    } else if (subcommand === 'revoke') {
      const keyId = args[0];
      if (!keyId) {
        print('red', 'Usage: sitemanager api-keys revoke <key-id>');
        process.exit(1);
      }

      const response = await apiRequest(`/admin/api-keys/${keyId}/revoke`, {
        method: 'POST',
      }, creds);

      print('green', '✓ API Key revoked');
    } else {
      print('red', 'Usage: sitemanager api-keys list|generate|revoke');
      process.exit(1);
    }
  } catch (err) {
    print('red', `✗ Error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help') {
    print('cyan', 'SiteManager+ CLI');
    console.log(`
Usage:
  sitemanager status                    Show server status
  sitemanager logs [lines]              Show recent logs
  sitemanager restart [rolling]         Trigger rolling restart
  sitemanager maintenance on|off        Toggle maintenance mode
  sitemanager api-keys list             List API keys
  sitemanager api-keys generate [name]  Generate new API key
  sitemanager api-keys revoke <id>      Revoke API key
  sitemanager health                    Quick health check
  sitemanager help                      Show this help

Environment:
  SITEMANAGER_API_KEY                   API key for authentication
    `);
    return;
  }

  try {
    switch (command) {
      case 'status':
        await cmdStatus();
        break;
      case 'logs':
        await cmdLogs(args[1]);
        break;
      case 'restart':
        await cmdRestart(args[1] || 'rolling');
        break;
      case 'maintenance':
        await cmdMaintenance(args[1]);
        break;
      case 'api-keys':
        await cmdAPIKeys(args[1], ...args.slice(2));
        break;
      case 'health':
        {
          const response = await apiRequest('/admin/health');
          print('green', '✓ System Health:');
          console.log(response);
        }
        break;
      default:
        print('red', `Unknown command: ${command}`);
        print('cyan', 'Run "sitemanager help" for usage');
        process.exit(1);
    }
  } catch (err) {
    print('red', `✗ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
