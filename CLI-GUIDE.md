# Interactive CLI Guide - SiteManager+

A production-ready, shell-less interactive command-line interface built entirely in Node.js. The CLI runs **simultaneously with the HTTP server** in the same process, allowing you to manage your SiteManager+ instance without spawning external shells.

## 🎯 Features

- ✅ **No Shell Spawning** - Pure Node.js readline, tty, and process APIs
- ✅ **Same Process** - Runs alongside HTTP server in master process
- ✅ **TTY & Non-TTY Support** - Works interactively or with piped input
- ✅ **Command History** - In-memory history with clear command
- ✅ **Graceful Shutdown** - Handles SIGINT/SIGTERM cleanly
- ✅ **Production Ready** - Error handling, logging, proper signal management
- ✅ **Modular Design** - Separate parser, command registry, and interactive modules

---

## 🚀 Getting Started

### Start the Server

```bash
npm start
# or in development
npm run dev
```

When the master process starts, the CLI automatically initializes if a TTY is available.

### First Prompt

```
═══════════════════════════════════════
  SiteManager+ Interactive CLI
  Type "help" for available commands
═══════════════════════════════════════

SiteManager+> _
```

---

## 📋 Commands

### System Status

**`status`** - Show current system status
```
SiteManager+> status
{
  system_health: "healthy",
  uptime_seconds: 3600,
  maintenance_enabled: false,
  memory_mb: 128,
  timestamp: "2025-12-18T00:00:00.000Z"
}
```

**`health`** - Comprehensive health check
```
SiteManager+> health
{
  overall: "healthy",
  workers: 4,
  worker_details: [...]
}
```

**`info`** - System information
```
SiteManager+> info
{
  app_name: "SiteManager+",
  version: "1.0.0",
  node_version: "v18.19.0",
  platform: "darwin",
  cpu_count: 8,
  memory_total_gb: 16,
  ...
}
```

### Worker Management

**`workers`** - List all workers
```
SiteManager+> workers
{
  count: 4,
  workers: [...]
}
```

**`restart [strategy]`** - Restart workers
```
SiteManager+> restart rolling        # Rolling restart (zero downtime)
SiteManager+> restart graceful       # Graceful shutdown
SiteManager+> restart force          # Force restart
SiteManager+> restart                # Default: rolling
```

**`worker <id> [action]`** - Manage individual worker
```
SiteManager+> worker 1               # Get worker 1 status
SiteManager+> worker 1 status        # Same as above
SiteManager+> worker 1 restart       # Restart worker 1
```

Aliases: `w`

### Maintenance Mode

**`maintenance <action> [reason]`** - Control maintenance mode
```
SiteManager+> maintenance on "Database migration"
SiteManager+> maintenance off
SiteManager+> maintenance status
```

Actions: `on`, `off`, `status`  
Aliases: `maint`, `m`

### Logs

**`logs [lines]`** - View recent logs
```
SiteManager+> logs                   # Last 50 lines (default)
SiteManager+> logs 100               # Last 100 lines
```

Aliases: `log`, `l`

### System Information

**`memory`** - Memory usage details
```
SiteManager+> memory
{
  process_heap_used_mb: 128,
  process_heap_total_mb: 256,
  process_rss_mb: 512,
  system_total_gb: 16,
  system_free_gb: 8
}
```

Aliases: `mem`

**`uptime`** - Process uptime
```
SiteManager+> uptime
{
  total_seconds: 3600,
  formatted: "1d 2h 30m 45s"
}
```

**`config [key]`** - Show configuration
```
SiteManager+> config              # All settings
SiteManager+> config port         # Specific setting
```

Aliases: `cfg`

### History & Help

**`history [action]`** - Command history
```
SiteManager+> history             # List all commands
SiteManager+> history clear       # Clear history
```

Aliases: `hist`

**`help [command]`** - Show help
```
SiteManager+> help                # Show all commands
SiteManager+> help status         # Help for specific command
```

Aliases: `?`, `h`

### Utility

**`clear`** - Clear screen
```
SiteManager+> clear
```

Aliases: `cls`

**`exit`** - Exit CLI (HTTP server continues)
```
SiteManager+> exit
Goodbye!
```

Aliases: `quit`, `q`

---

## 🎮 Interactive Features

### Tab Completion
Currently not supported, but command names are case-insensitive.

### Command History
Use UP/DOWN arrow keys to navigate previous commands.

### Quotes
Use single or double quotes for arguments with spaces:
```
SiteManager+> maintenance on "Long maintenance reason with spaces"
```

### Non-Interactive Mode
Pipe commands to the CLI:
```bash
echo "status
workers
health" | node src/index.js
```

---

## 🔧 Architecture

### File Structure
```
src/cli/
├── parser.js       - Command parser (tokenization, validation)
├── commands.js     - Command registry and handlers
├── interactive.js  - Interactive CLI with readline
└── index.js        - Module exports
```

### Parser (`parser.js`)
- Tokenizes user input
- Validates against registered commands
- Handles quoted arguments
- Returns structured command objects

### Commands (`commands.js`)
- `CommandRegistry` class manages all commands
- Each command is a handler function
- Handlers return `{ status, message, data }`
- In-memory command history

### Interactive (`interactive.js`)
- `InteractiveCLI` class manages the readline interface
- Runs concurrently with HTTP server
- Handles TTY detection
- Signal handling (SIGINT, SIGTERM)
- Formatted output

---

## 📡 Integration with Watchdog

The CLI has full access to the watchdog instance:

```javascript
// src/cli/commands.js
async cmdRestart(strategy = 'rolling') {
  if (strategy === 'rolling') {
    this.watchdog.gracefulRollingRestart('CLI initiated');
  }
  return { status: 'success', message: 'Restart initiated' };
}
```

This means CLI commands can:
- Query worker health
- Trigger rolling restarts
- Access system metrics
- Control maintenance mode

---

## 🚨 Signal Handling

The CLI gracefully handles process signals:

```javascript
// SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  this.shutdown('SIGINT');
});

// SIGTERM (kill signal)
process.on('SIGTERM', () => {
  this.shutdown('SIGTERM');
});
```

When exiting, the CLI:
1. Closes the readline interface
2. Logs the shutdown event
3. Allows the HTTP server to continue (if `autoClose: false`)

---

## 🐛 Debugging

### Enable CLI Logging
Set `LOG_LEVEL=debug` in `.env`:

```bash
LOG_LEVEL=debug npm start
```

Watch for messages like:
```
[DEBUG] No TTY detected, skipping interactive CLI
[INFO] Interactive CLI started
[INFO] CLI shutdown initiated
```

### Check If CLI is Running
```
SiteManager+> info
```

Look for `pid` field to confirm the CLI is in the master process.

---

## 🔐 Security Notes

- **No Shell Execution** - Commands are parsed internally, no `exec()` or `spawn()`
- **Limited Scope** - Only predefined commands are allowed
- **No File I/O** - Except for reading logs and config
- **Rate Limiting** - No global rate limiting (consider adding for production)
- **Authentication** - Uses same auth as HTTP server; add if needed

---

## 📊 Performance

The CLI adds minimal overhead:
- **Memory**: ~5-10 MB (readline + parser + registry)
- **CPU**: Idle until input received
- **I/O**: Only reads stdin, writes stdout/stderr

---

## 🚀 Production Deployment

### Systemd Service
The CLI works with systemd services:

```ini
# sitemanager.service
[Service]
Type=simple
ExecStart=node src/index.js
StandardInput=null
StandardOutput=journal
StandardError=journal
```

In systemd deployments:
- CLI is **not** available (no TTY)
- HTTP server runs normally
- Use HTTP endpoints for automation

### Docker Containers
The CLI works with `docker run -it`:

```bash
docker run -it sitemanager:latest
```

Without `-it`, the container will run the HTTP server normally.

---

## 🔄 Adding Custom Commands

To add a new command, edit [`src/cli/commands.js`](../src/cli/commands.js):

```javascript
// Add to registerAllCommands()
this.register('mycmd', this.cmdMyCommand.bind(this), ['alias'], 0, 2);

// Implement handler
async cmdMyCommand(arg1, arg2) {
  return {
    status: 'success',
    message: 'Command executed',
    data: { result: 'value' }
  };
}
```

---

## 📝 Examples

### Monitor System
```
SiteManager+> health
SiteManager+> memory
SiteManager+> workers
```

### Perform Maintenance
```
SiteManager+> maintenance on "Deploying new version"
SiteManager+> logs 100
SiteManager+> restart rolling
SiteManager+> maintenance off
```

### Check Configuration
```
SiteManager+> config
SiteManager+> config port
SiteManager+> config worker_count
```

### View History
```
SiteManager+> history
SiteManager+> history clear
```

---

## 🐞 Troubleshooting

### CLI Not Starting
**Symptom**: No prompt appears after `npm start`

**Causes**:
- Running in non-interactive mode (no TTY)
- Disabled with `--cli` flag not provided
- Error during initialization

**Solution**: Check logs with `LOG_LEVEL=debug npm start`

### Commands Not Working
**Symptom**: `Error: Unknown command: ...`

**Causes**:
- Typo in command name
- Command requires arguments

**Solution**: Run `help` to see all commands

### Slow Response
**Symptom**: Long delay before prompt returns

**Causes**:
- Large log file (logs command)
- Slow system (memory, info commands)
- Worker restart in progress

**Solution**: Use smaller line counts (`logs 10`), wait for restart

---

## 📚 More Information

- **Architecture**: See [ADVANCED-FEATURES.md](../ADVANCED-FEATURES.md)
- **HTTP Endpoints**: See [README.md](../README.md)
- **Deployment**: See [DEPLOYMENT-CHECKLIST.md](../DEPLOYMENT-CHECKLIST.md)
