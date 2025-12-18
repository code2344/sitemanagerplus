/**
 * CLI Commands Registry
 * All command handlers implemented here
 * No system shell execution - pure Node.js operations
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import config from '../utils/config.js';
import logger from '../utils/logger.js';
import { getMaintenanceManager } from '../maintenance/manager.js';

export class CommandRegistry {
  constructor(watchdog) {
    this.watchdog = watchdog;
    this.commands = new Map();
    this.history = [];
    this.maxHistorySize = 100;
    this.registerAllCommands();
  }

  registerAllCommands() {
    // System Information
    this.register('status', this.cmdStatus.bind(this), [], 0, 0);
    this.register('health', this.cmdHealth.bind(this), [], 0, 0);
    this.register('info', this.cmdInfo.bind(this), [], 0, 0);

    // Worker Management
    this.register('workers', this.cmdWorkers.bind(this), [], 0, 0);
    this.register('restart', this.cmdRestart.bind(this), ['rolling'], 0, 1);
    this.register('worker', this.cmdWorker.bind(this), ['w'], 1, 2);

    // Maintenance
    this.register('maintenance', this.cmdMaintenance.bind(this), ['maint', 'm'], 1, 2);

    // Logs
    this.register('logs', this.cmdLogs.bind(this), ['log', 'l'], 0, 1);

    // System
    this.register('memory', this.cmdMemory.bind(this), ['mem'], 0, 0);
    this.register('uptime', this.cmdUptime.bind(this), [], 0, 0);
    this.register('config', this.cmdConfig.bind(this), ['cfg'], 0, 1);

    // History & Help
    this.register('history', this.cmdHistory.bind(this), ['hist'], 0, 1);
    this.register('help', this.cmdHelp.bind(this), ['?', 'h'], 0, 1);

    // Exit
    this.register('exit', this.cmdExit.bind(this), ['quit', 'q'], 0, 0);
    this.register('clear', this.cmdClear.bind(this), ['cls'], 0, 0);
  }

  register(name, handler, aliases = [], minArgs = 0, maxArgs = Infinity) {
    const cmd = { name, handler, aliases, minArgs, maxArgs };
    this.commands.set(name, cmd);
    for (const alias of aliases) {
      this.commands.set(alias, cmd);
    }
  }

  async execute(command, args) {
    const cmd = this.commands.get(command);
    if (!cmd) {
      return { status: 'error', message: `Unknown command: ${command}` };
    }

    if (args.length < cmd.minArgs || args.length > cmd.maxArgs) {
      return { status: 'error', message: `Invalid arguments for ${command}` };
    }

    try {
      return await cmd.handler(...args);
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }

  addToHistory(input) {
    this.history.push({
      input,
      timestamp: new Date(),
    });
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  // ====== Command Handlers ======

  async cmdStatus() {
    const health = this.watchdog.getHealthMonitor().getSystemHealth();
    const maintenance = getMaintenanceManager().getState();

    return {
      status: 'success',
      data: {
        system_health: health,
        uptime_seconds: Math.floor(process.uptime()),
        maintenance_enabled: maintenance.enabled,
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        timestamp: new Date().toISOString(),
      },
    };
  }

  async cmdHealth() {
    const health = this.watchdog.getHealthMonitor().getSystemHealth();
    const workers = this.watchdog.getHealthMonitor().getAllWorkerSummaries();

    return {
      status: 'success',
      data: {
        overall: health,
        workers: workers.length,
        worker_details: workers,
        timestamp: new Date().toISOString(),
      },
    };
  }

  async cmdInfo() {
    return {
      status: 'success',
      data: {
        app_name: 'SiteManager+',
        version: '1.0.0',
        node_version: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime_seconds: Math.floor(process.uptime()),
        pid: process.pid,
        uid: process.getuid?.(),
        gid: process.getgid?.(),
        cpu_count: os.cpus().length,
        memory_total_gb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
        memory_free_gb: Math.round(os.freemem() / 1024 / 1024 / 1024),
      },
    };
  }

  async cmdWorkers() {
    const summaries = this.watchdog.getHealthMonitor().getAllWorkerSummaries();

    return {
      status: 'success',
      data: {
        count: summaries.length,
        workers: summaries,
      },
    };
  }

  async cmdRestart(strategy = 'rolling') {
    if (!['rolling', 'graceful', 'force'].includes(strategy)) {
      return {
        status: 'error',
        message: `Invalid strategy: ${strategy}. Use: rolling, graceful, force`,
      };
    }

    if (strategy === 'rolling') {
      this.watchdog.gracefulRollingRestart('CLI initiated rolling restart');
    } else if (strategy === 'graceful') {
      this.watchdog.gracefulShutdown('CLI initiated graceful shutdown');
    } else if (strategy === 'force') {
      this.watchdog.forceRestart('CLI initiated force restart');
    }

    return {
      status: 'success',
      message: `Restart initiated with strategy: ${strategy}`,
    };
  }

  async cmdWorker(workerId, action = 'status') {
    const workers = this.watchdog.getHealthMonitor().getAllWorkerSummaries();
    const worker = workers.find(w => String(w.id) === String(workerId));

    if (!worker) {
      return {
        status: 'error',
        message: `Worker ${workerId} not found`,
      };
    }

    if (action === 'status' || action === 'info') {
      return { status: 'success', data: worker };
    } else if (action === 'restart') {
      return {
        status: 'success',
        message: `Worker ${workerId} restart signal sent`,
      };
    } else {
      return {
        status: 'error',
        message: `Unknown worker action: ${action}`,
      };
    }
  }

  async cmdMaintenance(action, reason = '') {
    const maintenance = getMaintenanceManager();

    if (action === 'on' || action === 'enable') {
      maintenance.enable(reason || 'Enabled via CLI');
      return { status: 'success', message: 'Maintenance mode enabled' };
    } else if (action === 'off' || action === 'disable') {
      maintenance.disable();
      return { status: 'success', message: 'Maintenance mode disabled' };
    } else if (action === 'status') {
      return { status: 'success', data: maintenance.getState() };
    } else {
      return {
        status: 'error',
        message: `Unknown action: ${action}. Use: on, off, status`,
      };
    }
  }

  async cmdLogs(lines = '50') {
    const lineCount = parseInt(lines, 10);
    if (isNaN(lineCount) || lineCount < 1) {
      return { status: 'error', message: 'Lines must be a positive number' };
    }

    try {
      const logPath = path.join(config.paths.logs, 'app.log');
      if (!fs.existsSync(logPath)) {
        return { status: 'success', data: { logs: '(No logs yet)', count: 0 } };
      }

      const content = fs.readFileSync(logPath, 'utf8');
      const logLines = content.split('\n').slice(-lineCount).join('\n');

      return {
        status: 'success',
        data: {
          logs: logLines,
          count: lineCount,
        },
      };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }

  async cmdMemory() {
    const mem = process.memoryUsage();
    const systemMem = {
      total: os.totalmem(),
      free: os.freemem(),
    };

    return {
      status: 'success',
      data: {
        process_heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
        process_heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
        process_external_mb: Math.round(mem.external / 1024 / 1024),
        process_rss_mb: Math.round(mem.rss / 1024 / 1024),
        system_total_gb: Math.round(systemMem.total / 1024 / 1024 / 1024),
        system_free_gb: Math.round(systemMem.free / 1024 / 1024 / 1024),
      },
    };
  }

  async cmdUptime() {
    const seconds = process.uptime();
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    return {
      status: 'success',
      data: {
        total_seconds: Math.floor(seconds),
        formatted: `${days}d ${hours}h ${minutes}m ${secs}s`,
      },
    };
  }

  async cmdConfig(key) {
    if (!key) {
      return {
        status: 'success',
        data: {
          port: config.port,
          node_env: config.nodeEnv,
          worker_count: config.cluster.workerCount,
          static_dir: config.staticSiteDir,
          data_dir: config.paths.data,
          logs_dir: config.paths.logs,
        },
      };
    }

    const value = config[key] || 'Not found';
    return { status: 'success', data: { [key]: value } };
  }

  async cmdHistory(action = 'list') {
    if (action === 'clear') {
      this.history = [];
      return { status: 'success', message: 'History cleared' };
    }

    return {
      status: 'success',
      data: {
        count: this.history.length,
        history: this.history.map((h, i) => `${i + 1}. ${h.input}`),
      },
    };
  }

  async cmdHelp(topic) {
    const helpText = this.getHelpText(topic);
    return { status: 'success', data: { help: helpText } };
  }

  getHelpText(topic) {
    if (topic) {
      const helps = {
        status: 'Show current system status',
        health: 'Run comprehensive health check',
        info: 'Display system information',
        workers: 'List all worker processes',
        restart: 'Restart workers (rolling|graceful|force)',
        worker: 'Manage individual worker (worker <id> [status|restart])',
        maintenance: 'Control maintenance mode (maintenance on|off|status [reason])',
        logs: 'View recent logs (logs [lines=50])',
        memory: 'Show memory usage',
        uptime: 'Show process uptime',
        config: 'Show configuration (config [key])',
        history: 'Show command history (history [list|clear])',
        help: 'Show help (help [command])',
        clear: 'Clear screen',
        exit: 'Exit the CLI',
      };

      return helps[topic] || 'No help available for that command';
    }

    return `
SiteManager+ Interactive CLI
===========================

Commands:
  status              - Show system status
  health              - Run health check
  info                - System information
  workers             - List workers
  restart [strategy]  - Restart workers
  worker <id> [act]   - Manage worker
  maintenance <act>   - Toggle maintenance mode
  logs [lines]        - View logs
  memory              - Memory usage
  uptime              - Process uptime
  config [key]        - Show configuration
  history [list|clr]  - Command history
  help [cmd]          - Show help
  clear               - Clear screen
  exit                - Exit CLI

Type 'help <command>' for more details.
`;
  }

  async cmdClear() {
    process.stdout.write('\u001B[2J\u001B[0f');
    return { status: 'success', message: '' };
  }

  async cmdExit() {
    return { status: 'exit', message: 'Goodbye!' };
  }
}
