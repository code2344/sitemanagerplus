/**
 * Interactive CLI
 * Runs in the master process alongside HTTP server
 * Handles user input via stdin/stdout
 * No shell spawning - pure Node.js readline
 * 
 * Logs appear above, CLI prompt stays at bottom
 * Uses raw terminal mode with cursor positioning
 */

import readline from 'readline';
import tty from 'tty';
import fs from 'fs';
import path from 'path';
import { CommandParser } from './parser.js';
import { CommandRegistry } from './commands.js';
import logger from '../utils/logger.js';

export class InteractiveCLI {
  constructor(watchdog, options = {}) {
    this.watchdog = watchdog;
    this.parser = new CommandParser();
    this.registry = new CommandRegistry(watchdog);
    this.isRunning = false;
    this.logStream = null;
    this.originalConsoleLog = console.log;
    this.originalConsoleError = console.error;
    this.originalConsoleWarn = console.warn;
    
    this.options = {
      prompt: 'SiteManager+> ',
      historyFile: options.historyFile,
      autoClose: options.autoClose !== false,
      ...options,
    };

    // Setup readline with raw mode for better control
    const input = process.stdin;
    const output = process.stdout;

    this.rl = readline.createInterface({
      input,
      output,
      prompt: this.options.prompt,
      terminal: tty.isatty(input.fd),
      historySize: 100,
      emitKeypressEvents: true,
    });

    this.setupCommandParsing();
    this.setupSignalHandlers();
    this.redirectLogsToFile();
  }

  /**
   * Redirect logs to file when CLI is active
   * System logs go to file, CLI output stays on screen
   */
  redirectLogsToFile() {
    const logsDir = path.join(process.cwd(), 'logs');
    const logFile = path.join(logsDir, 'cli-system.log');

    // Ensure logs directory exists
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Redirect console methods to file (keep CLI clean)
    console.log = (...args) => {
      const msg = args.join(' ');
      // Only log non-CLI messages
      if (!msg.includes('SiteManager+>')) {
        try {
          fs.appendFileSync(logFile, msg + '\n');
        } catch (e) {
          this.originalConsoleLog(msg);
        }
      }
    };

    console.error = (...args) => {
      const msg = args.join(' ');
      try {
        fs.appendFileSync(logFile, '[ERROR] ' + msg + '\n');
      } catch (e) {
        this.originalConsoleError(msg);
      }
    };

    console.warn = (...args) => {
      const msg = args.join(' ');
      try {
        fs.appendFileSync(logFile, '[WARN] ' + msg + '\n');
      } catch (e) {
        this.originalConsoleWarn(msg);
      }
    };
  }

  setupCommandParsing() {
    // Register all commands with parser
    this.registry.commands.forEach((cmd) => {
      this.parser.register(cmd.name, cmd.aliases, cmd.minArgs, cmd.maxArgs);
    });
  }

  setupSignalHandlers() {
    // Handle SIGINT (Ctrl+C) - graceful shutdown
    process.on('SIGINT', () => {
      this.shutdown('SIGINT');
    });

    // Handle SIGTERM (kill signal) - graceful shutdown
    process.on('SIGTERM', () => {
      this.shutdown('SIGTERM');
    });

    // Handle readline close
    this.rl.on('close', () => {
      if (this.isRunning) {
        this.shutdown('readline-close');
      }
    });
  }

  async start() {
    if (this.isRunning) {
      logger.warn('CLI already running');
      return;
    }

    this.isRunning = true;
    logger.info('Interactive CLI started', { pid: process.pid });

    // Create sentinel file to signal logger to suppress console output globally
    try {
      const logsDir = path.join(process.cwd(), 'logs');
      const sentinel = path.join(logsDir, '.cli-active');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      fs.writeFileSync(sentinel, String(Date.now()), 'utf8');
    } catch (e) {
      // Non-fatal
      logger.debug('Failed to create CLI sentinel', { error: e.message });
    }

    // Show welcome message
    if (this.rl.terminal) {
      this.write('\n═══════════════════════════════════════');
      this.write('  SiteManager+ Interactive CLI');
      this.write('  Type "help" for available commands');
      this.write('═══════════════════════════════════════\n');
    }

    // Start accepting input
    this.rl.prompt();

    // Handle each line of input
    return new Promise((resolve) => {
      this.rl.on('line', async (input) => {
        // Add to history
        if (input.trim()) {
          this.registry.addToHistory(input);
        }

        // Parse command
        const parsed = this.parser.parse(input);

        if (parsed === null) {
          // Empty input
          this.rl.prompt();
          return;
        }

        if (parsed.type === 'error') {
          this.write(`Error: ${parsed.error}`);
          this.rl.prompt();
          return;
        }

        // Execute command
        const result = await this.registry.execute(parsed.command, parsed.args);

        // Handle result
        if (result.status === 'exit') {
          this.write(`\n${result.message}`);
          resolve();
          this.rl.close();
          return;
        }

        if (result.status === 'error') {
          this.write(`Error: ${result.message}`);
        } else if (result.status === 'success' && result.message) {
          this.write(result.message);
        }

        // Output data if present
        if (result.data) {
          this.outputData(result.data);
        }

        // Show prompt for next input
        this.rl.prompt();
      });
    });
  }

  outputData(data) {
    if (typeof data === 'string') {
      this.write(data);
      return;
    }

    // Format data as structured output
    const output = this.formatOutput(data);
    this.write(output);
  }

  formatOutput(data, indent = 0) {
    const spaces = ' '.repeat(indent);
    const nextIndent = indent + 2;
    const nextSpaces = ' '.repeat(nextIndent);

    if (Array.isArray(data)) {
      if (data.length === 0) return '[]';
      return '[\n' + data.map(item => {
        const formatted = this.formatOutput(item, nextIndent);
        return `${nextSpaces}${formatted}`;
      }).join(',\n') + '\n' + spaces + ']';
    }

    if (data === null || data === undefined) {
      return String(data);
    }

    if (typeof data !== 'object') {
      return String(data);
    }

    // Object formatting
    const keys = Object.keys(data);
    if (keys.length === 0) return '{}';

    return '{\n' + keys.map(key => {
      const value = data[key];
      const formatted = this.formatOutput(value, nextIndent);
      return `${nextSpaces}${key}: ${formatted}`;
    }).join('\n') + '\n' + spaces + '}';
  }

  write(message) {
    if (!message) return;
    // Ensure message ends with newline and prompt follows
    const text = String(message).trimRight();
    this.rl.output.write(`${text}\n`);
  }

  async shutdown(signal) {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    // Remove sentinel to re-enable console logging
    try {
      const sentinel = path.join(process.cwd(), 'logs', '.cli-active');
      if (fs.existsSync(sentinel)) fs.rmSync(sentinel, { force: true });
    } catch {}

    // Restore console methods
    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
    console.warn = this.originalConsoleWarn;
    
    logger.info(`CLI shutdown initiated`, { signal, pid: process.pid });

    // Close readline
    this.rl.close();

    if (this.options.autoClose) {
      // Exit after a short delay
      setTimeout(() => {
        process.exit(0);
      }, 100);
    }
  }

  /**
   * Handle non-TTY mode (e.g., piped input)
   * Reads lines from stdin and processes them
   */
  async runNonInteractive() {
    return new Promise((resolve) => {
      this.rl.on('line', async (input) => {
        if (input.trim()) {
          this.registry.addToHistory(input);
          const parsed = this.parser.parse(input);

          if (parsed && parsed.type === 'command') {
            const result = await this.registry.execute(parsed.command, parsed.args);

            if (result.status === 'exit') {
              resolve();
              this.rl.close();
              return;
            }

            if (result.data) {
              this.outputData(result.data);
            }
            if (result.message && result.status === 'error') {
              this.write(`Error: ${result.message}`);
            }
          }
        }
      });

      this.rl.on('close', () => {
        resolve();
      });
    });
  }
}
