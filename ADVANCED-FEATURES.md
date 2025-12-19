# Advanced Features Guide - SiteManager+

This guide covers all the advanced features implemented in SiteManager+.

## Table of Contents

1. [Docker Support](#docker-support)
2. [Prometheus Metrics](#prometheus-metrics)
3. [API Key Authentication](#api-key-authentication)
4. [Request Tracing](#request-tracing)
5. [CLI Tool](#cli-tool)
6. [SSL/TLS Support](#ssltls-support)
7. [Scheduled Tasks](#scheduled-tasks)
8. [Multi-Channel Alerts](#multi-channel-alerts)
9. [Plugin System](#plugin-system)
10. [Load Testing](#load-testing)
11. [Development Mode](#development-mode)
12. [Systemd Integration](#systemd-integration)
13. [Hardware Keys + OTP Reset](#hardware-keys--otp-reset)
14. [Admin Feature Endpoints](#admin-feature-endpoints)
15. [Ops Feature Endpoints](#ops-feature-endpoints)

---

## Docker Support

### Quick Start

```bash
# Build and run with Docker
docker-compose up -d

# View logs
docker-compose logs -f sitemanager

# Stop
docker-compose down
```

### Docker Compose Services

- **sitemanager**: Main application (port 3000)
- **prometheus**: Metrics collection (port 9090)
- **grafana**: Visualization (port 3001, default: admin/admin)

### Custom Docker Build

```bash
# Build image
docker build -t sitemanager .

# Run container
docker run -p 3000:3000 \
  -v $(pwd)/website:/app/website \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  -e ADMIN_PASSWORD=secure-password \
  sitemanager
```

---

## Prometheus Metrics

### Access Metrics

```bash
# Get raw Prometheus format
curl http://localhost:3000/admin/metrics

# Get metrics summary
curl -u admin:password http://localhost:3000/admin/metrics/summary
```

### Available Metrics

- `requests_total` - Total HTTP requests
- `requests_errors_total` - Total request errors
- `request_duration_ms` - Average response time\
- `request_duration_p50/p95/p99` - Response time percentiles
- `method_request_count` - Requests by HTTP method
- `status_code_count` - Responses by status code
- `worker_memory_mb` - Worker memory usage
- `worker_uptime_seconds` - Worker uptime
- `cache_hits_total` - Cache hit count
- `cache_misses_total` - Cache miss count

### Grafana Integration

1. Add Prometheus data source:
   - URL: `http://prometheus:9090`
   
2. Create dashboards using the metrics

3. Set up alerts based on thresholds

---

## API Key Authentication

### Generate API Key

```bash
sitemanager api-keys generate my-key

# Output:
# ✓ API Key generated:
# sm_abc123...xyz.secret...
# Save this key securely - it cannot be recovered!
```

### Use API Key

```bash
# In authorization header
curl -H "Authorization: Bearer sm_abc123...xyz.secret..." \
  http://localhost:3000/admin/status

# Using CLI with environment variable
export SITEMANAGER_API_KEY="sm_abc123...xyz.secret..."
sitemanager status
```

### CLI Commands

```bash
# List keys
sitemanager api-keys list

# Generate key with scopes
sitemanager api-keys generate api-robot read write

# Revoke key
sitemanager api-keys revoke <key-id>
```

### Key Features

- Automatic expiration support
- Per-key rate limiting
- Scoped permissions (read/write)
- Secure storage in `data/api-keys.json`
- Audit logging of all operations

---

## Request Tracing

### How It Works

Every request gets a unique trace ID for distributed tracing:

```
X-Trace-ID: req_550e8400-e29b-41d4-a716-446655440000
X-Response-Time: 45ms
```

### Trace Headers

```bash
# Check trace ID in response
curl -i http://localhost:3000/

# Propagate trace across services
curl -H "X-Trace-ID: custom-trace-id" http://localhost:3000/
```

### Log Correlation

All logs include trace information:

```json
{
  "timestamp": "2025-12-17T10:30:00.000Z",
  "level": "HTTP",
  "traceId": "req_550e8400...",
  "message": "GET / -> 200",
  "duration": 45
}
```

---

## CLI Tool

### Installation

```bash
# Already included in project
node bin/cli.js status

# Or after npm install -g
npm install -g .
sitemanager status
```

### Commands

```bash
# Show status
sitemanager status

# View logs (last 50 lines)
sitemanager logs [lines]

# Trigger rolling restart
sitemanager restart

# Toggle maintenance
sitemanager maintenance on
sitemanager maintenance off

# Health check
sitemanager health

# API key management
sitemanager api-keys list
sitemanager api-keys generate my-key
sitemanager api-keys revoke <id>
```

### Credential Caching

The CLI saves credentials securely in `~/.sitemanager-creds`:

```bash
# First run
sitemanager status
> Use stored admin credentials? (y/n) y
> Save credentials? (y/n) y

# Subsequent runs use cached credentials
sitemanager status
```

---

## SSL/TLS Support

### Enable HTTPS

```bash
# In .env
ENABLE_HTTPS=true
```

### Auto-Generated Certificates

On first run, SiteManager+ generates self-signed certificates:

```
data/certs/
  ├── cert.pem
  └── key.pem
```

### Custom Certificates

Replace auto-generated certs with your own:

```bash
cp your-cert.pem data/certs/cert.pem
cp your-key.pem data/certs/key.pem
```

### Certificate Info

```bash
# Check certificate details
openssl x509 -in data/certs/cert.pem -text -noout

# Verify key pair
openssl pkey -in data/certs/key.pem -check
```

---

## Scheduled Tasks

### Configure Scheduled Restarts

```env
# Restart daily at 2 AM
SCHEDULED_ROLLING_RESTART=0 2 * * *

# Restart every Sunday at 3 AM
SCHEDULED_ROLLING_RESTART=0 3 * * 0

# Restart every 6 hours
SCHEDULED_ROLLING_RESTART=0 */6 * * *
```

### Cron Syntax

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
│ │ │ │ │
* * * * *
```

### Built-in Tasks

1. **Log Rotation** - Daily at 2 AM
   - Rotates logs > 100MB
   - Keeps 7 days of logs

2. **Health Report** - Daily at 6 AM
   - Generates system health summary
   - Can send via email alerts

---

## Multi-Channel Alerts

### Slack Integration

```bash
# Set webhook URL in .env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

Alerts appear in Slack with:
- Alert severity (info/warning/critical)
- Timestamp
- Detailed message

### Discord Integration

```bash
# Set webhook URL in .env
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/CHANNEL_ID/TOKEN
```

Alerts appear as Discord embeds with color coding.

### PagerDuty Integration

```bash
# Set integration key in .env
PAGERDUTY_INTEGRATION_KEY=YOUR_KEY
```

Critical alerts trigger PagerDuty incidents.

### Custom Webhooks

```bash
# Set any webhook endpoint
CUSTOM_WEBHOOK_URL=https://your-server.example.com/alerts

# Receives POST with:
# {
#   "title": "Alert Title",
#   "message": "Alert details",
#   "severity": "critical",
#   "timestamp": "2025-12-17T10:30:00Z"
# }
```

### Quiet Hours

Suppress alerts during specific times:

```env
# Don't send alerts 10 PM to 8 AM
ALERT_QUIET_HOURS=22:00-08:00
```

---

## Plugin System

---

## Admin Feature Endpoints

- Backups: `POST /admin/backups/create`, `GET /admin/backups/list`, `POST /admin/backups/restore`
- Backup zips: `POST /admin/backups/create-zip`, `POST /admin/backups/prune`
- Cache: `POST /admin/cache/purge`
- SSL: `POST /admin/ssl/generate`, `GET /admin/ssl/status`
- Workers: `POST /admin/config/worker-count/update`
- Scheduled: `GET /admin/scheduled/jobs`, `POST /admin/scheduled/log-rotation/run`
- Audit: `GET /admin/audit/logs`
- Sessions: `POST /admin/sessions/revoke-all`
- Alerts: `POST /admin/alerts/test-email`
- Webhooks: `GET /admin/webhooks/list`, `POST /admin/webhooks/test`
- Static: `GET /admin/static/size`
- File manager: `GET /admin/files/list`, `POST /admin/files/read`, `POST /admin/files/write`, `POST /admin/files/delete`
- Logs: `POST /admin/logs`, `GET /admin/logs/list`, `GET /admin/logs/download/:logname`, `POST /admin/logs/rotate`
- Maintenance Page: `POST /admin/maintenance/page/edit`
- Plugins: `POST /admin/plugins/reload`, `POST /admin/plugins/:name/toggle`
- Metrics: `GET /admin/metrics`, `GET /admin/metrics/summary`, `POST /admin/metrics/reset`
- Tracing: `POST /admin/tracing/toggle`
- Security Headers: `POST /admin/security/headers/set`
- CSP Policy: `POST /admin/security/csp/set`
- Config override: `GET /admin/config/override/get`, `POST /admin/config/override/set`
- Log management: `POST /admin/logs/clear/:logname`, `GET /admin/logs/access`, `GET /admin/logs/errors`
- Hardware Key: `POST /admin/webauthn/register/start`, `POST /admin/webauthn/register/verify`, `GET /admin/hw`, `POST /admin/webauthn/start`, `POST /admin/webauthn/verify`, `POST /admin/reset-hw`
- SMP backups: `GET /admin/backups/export-smp`, `POST /admin/backups/import-smp-from-url`, `POST /admin/backups/import-smp-upload`
- Accounts: `GET /admin/accounts/:role/list`, `POST /admin/accounts/:role/add`, `POST /admin/accounts/:role/remove`
- System snapshot: `GET /admin/system/snapshot`

### Backups (.smp)

- Export: `GET /admin/backups/export-smp` — downloads a `.smp` (renamed zip) containing `website/`, `data/`, and `maintenance/` contents.
- Import from URL: `POST /admin/backups/import-smp-from-url { url }` — fetches a remote `.smp` and restores.
- Import upload: `POST /admin/backups/import-smp-upload` — accepts multipart file upload field `file` and restores.

### Accounts Management

- List: `GET /admin/accounts/:role/list` — role is `admin` or `maintenance`.
- Add: `POST /admin/accounts/:role/add { username, password }`
- Remove: `POST /admin/accounts/:role/remove { username }`

UI integration is available in the Admin dashboard: Backups (export/import by URL/upload) and Accounts (list/add/remove).

## Ops Feature Endpoints (Maintenance)

In addition to existing operations endpoints, backups are accessible to ops:

- Export: `GET /maintenance/backups/export-smp`
- Import from URL: `POST /maintenance/backups/import-smp-from-url { url }`

UI integration is available in the Maintenance dashboard: Backups (export/import by URL).

### Create a Plugin

```javascript
// plugins/my-plugin/index.js

import { Plugin } from '../../src/utils/plugin-system.js';

export default class MyPlugin extends Plugin {
  constructor() {
    super('my-plugin', '1.0.0');
  }

  async init() {
    console.log('Plugin initialized');
  }

  getMiddleware() {
    return [(req, res, next) => {
      res.setHeader('X-My-Plugin', 'active');
      next();
    }];
  }

  getRoutes() {
    return [{
      path: '/my-plugin/status',
      handler: (req, res) => res.json({ status: 'ok' })
    }];
  }

  getHealthChecks() {
    return [{
      name: 'my-plugin',
      check: async () => ({ healthy: true })
    }];
  }

  async cleanup() {
    console.log('Plugin cleaning up');
  }
}
```

### Plugin Directory Structure

```
plugins/
  ├── my-plugin/
  │   ├── index.js       # Plugin main file
  │   ├── package.json
  │   └── README.md
  └── another-plugin/
      └── index.js
```

### Manage Plugins

```bash
# List plugins
sitemanager plugins list

# Enable/disable plugin
curl -u admin:password -X POST \
  http://localhost:3000/admin/plugins/my-plugin/toggle
```

---

## Load Testing

---

## Ops Feature Endpoints

- Rolling Restart: `POST /maintenance/restart/rolling`
- Worker Control: `POST /maintenance/restart/worker/:workerId`, `POST /maintenance/restart/worker/:workerId/force`
- Logs: `GET /maintenance/logs`, `GET /maintenance/logs/files`, `POST /maintenance/logs/rotate`
- Cache: `POST /maintenance/cache/clear`
- Plugins: `POST /maintenance/plugins/reload`
- Watchdog: `POST /maintenance/watchdog/restart`, `GET /maintenance/watchdog/status`
- Thresholds: `POST /maintenance/thresholds/update`
- Disk/Network/Process: `GET /maintenance/disk/usage`, `GET /maintenance/network/ports`, `GET /maintenance/process/list`
- Static Backups: `POST /maintenance/static/backup`, `POST /maintenance/static/restore`
- SSL: `GET /maintenance/ssl/validate`
- Alerts: `POST /maintenance/alerts/test`
- Tracing: `POST /maintenance/tracing/toggle`
- Debug: `POST /maintenance/debug/enable`, `POST /maintenance/debug/disable`
- Health: `GET /maintenance/health/run-check`
- Scheduled: `GET /maintenance/scheduled/jobs`
- Sessions: `POST /maintenance/sessions/revoke-all`
- Config Reload: `POST /maintenance/config/reload`
- Maintenance Extend: `POST /maintenance/maintenance/extend`
- Hardware Key: `POST /maintenance/webauthn/register/start`, `POST /maintenance/webauthn/register/verify`, `GET /maintenance/hw`, `POST /maintenance/webauthn/start`, `POST /maintenance/webauthn/verify`, `POST /maintenance/reset-hw`

### Run Load Test (Dev Mode Only)

```bash
# Trigger via API
curl -u admin:password -X POST \
  -H "Content-Type: application/json" \
  -d '{"duration": 5000, "concurrency": 10}' \
  http://localhost:3000/admin/load-test

# Result:
# {
#   "totalRequests": 450,
#   "failedRequests": 0,
#   "duration": 5000,
#   "avgResponseTime": 11,
#   "requestsPerSecond": "90.00"
# }
```

### Chaos Engineering

```bash
# Simulate worker crash
curl -u admin:password -X POST \
  http://localhost:3000/admin/simulate/crash

# Simulate high memory usage
curl -u admin:password -X POST \
  -H "Content-Type: application/json" \
  -d '{"sizeGB": 0.5, "duration": 10000}' \
  http://localhost:3000/admin/simulate/memory

# Simulate event loop lag
curl -u admin:password -X POST \
  -H "Content-Type: application/json" \
  -d '{"duration": 5000}' \
  http://localhost:3000/admin/simulate/lag
```

---

## Development Mode

### Enable Development Mode

```bash
# In .env
NODE_ENV=development

# Or on command line
NODE_ENV=development npm start
```

### Features

1. **Auto-Reload**
   - File changes reload without restart
   - Useful during development

2. **Detailed Logging**
   - Request/response logging
   - Stack traces in errors
   - Debug messages enabled

3. **Disabled Caching**
   - All responses uncached
   - Always fetch fresh content

4. **Load Testing Available**
   - `/admin/load-test` enabled
   - `/admin/simulate/*` endpoints enabled

### Development CLI

```bash
npm run dev
```

---

## Systemd Integration

---

## Hardware Keys + OTP Reset

- Overview: Password-based first login, then hardware key required.
- Admin and Ops panels support WebAuthn security keys.
- Reset flow: Provide a 6-digit OTP to clear hardware key and re-register.

### Generate OTP (offline)

```bash
# Input the app secret (SESSION_SECRET from .env or data/session-secret)
./bin/otp.sh <APP_SECRET>
# Shows valid OTPs for the current and last 4 minutes
```

### Use OTP to reset

- Admin: POST `/admin/reset-hw` with `{ otp: "123456" }`
- Ops: POST `/maintenance/reset-hw` with `{ otp: "123456" }`
- On success, hardware credentials are cleared; re-register via panel.

### Install as Service

```bash
sudo ./install.sh
```

### Start Service

```bash
sudo systemctl start sitemanager
sudo systemctl enable sitemanager
```

### View Logs

```bash
# Live logs
sudo journalctl -u sitemanager -f

# Last 100 lines
sudo journalctl -u sitemanager -n 100

# Filter by level
sudo journalctl -u sitemanager -p err
```

### Service Management

```bash
# Check status
sudo systemctl status sitemanager

# Restart
sudo systemctl restart sitemanager

# Stop
sudo systemctl stop sitemanager

# Reload configuration
sudo systemctl reload sitemanager
```

### Configuration File

Location: `/etc/sitemanager/sitemanager.env`

```bash
# Edit settings
sudo nano /etc/sitemanager/sitemanager.env

# Restart to apply changes
sudo systemctl restart sitemanager
```

---

## Best Practices

1. **Use API Keys** for programmatic access (safer than Basic Auth)
2. **Configure Multi-Channel Alerts** for critical environments
3. **Set Quiet Hours** to reduce alert fatigue
4. **Use Prometheus + Grafana** for production monitoring
5. **Enable Scheduled Restarts** for predictable maintenance windows
6. **Use Docker** for consistent environments
7. **Keep Logs Rotated** via scheduled tasks
8. **Monitor Memory** with alerts on threshold
9. **Test Chaos Scenarios** in dev/staging before production
10. **Use Systemd** for reliable auto-restart capability

---

## Troubleshooting

### Metrics not appearing

```bash
# Check endpoint
curl http://localhost:3000/admin/metrics

# Verify Prometheus scraping
curl http://prometheus:9090/api/v1/targets
```

### API Key issues

```bash
# Regenerate key
sitemanager api-keys list
sitemanager api-keys revoke <old-id>
sitemanager api-keys generate new-key
```

### Scheduled tasks not running

```bash
# Check logs for cron errors
tail -f logs/error.log | grep cron

# Verify cron expression
NODE_ENV=development node -e "
  const cron = require('node-cron');
  console.log(cron.validate('0 2 * * *'));
"
```

### Plugin loading issues

```bash
# Check plugin structure
ls -la plugins/*/index.js

# View detailed logs
NODE_ENV=development npm start
```
