# SiteManager+ Quick Start Guide

Welcome to **SiteManager+** - a production-grade, ultra fault-tolerant Node.js server runtime for serving static websites with enterprise-grade features.

## 🚀 Quick Start (5 minutes)

### Prerequisites
- Node.js 16+
- npm or yarn
- (Optional) Docker & Docker Compose for containerized deployment

### 1. Installation

```bash
# Clone or navigate to your project directory
cd /Users/Ruben/sitemanagerplus

# Install dependencies
npm install

# Copy example configuration
cp .env.example .env

# Create your static website in the /website directory
# Add your HTML, CSS, JS, and other static assets here
```

### 2. Add Your Website

Create `website/index.html` with your content:

```html
<!DOCTYPE html>
<html>
<head>
    <title>My Website</title>
</head>
<body>
    <h1>Welcome to My Site</h1>
    <p>This is served by SiteManager+</p>
</body>
</html>
```

### 3. Start the Server

#### Option A: Development Mode (with auto-reload)

```bash
npm run dev
```

- Auto-reloads when you modify files
- Enhanced logging and error details
- Load testing endpoints enabled
- Accessible at `http://localhost:3000`

#### Option B: Production Mode (multi-worker, clustering)

```bash
npm start
```

- Multiple worker processes
- Automatic recovery from crashes
- Watchdog monitoring
- Health checks enabled
- Metrics endpoint at `/admin/metrics`

#### Option C: Docker

```bash
# Build and start with Prometheus & Grafana
docker-compose up

# Access:
# - SiteManager: http://localhost:3000
# - Prometheus: http://localhost:9090
# - Grafana: http://localhost:3001
```

## 📊 Access Admin Panels

### Admin Dashboard (default password: "admin123")

```
http://localhost:3000/admin
Username: admin
Password: (see .env ADMIN_PASSWORD)
```

**Features:**
- Real-time metrics and statistics
- Worker information and status
- Health check results
- API key management
- Plugin management
- (Dev mode only) Load testing tools

### Maintenance Panel (default password: "ops123")

```
http://localhost:3000/maintenance
Username: admin
Password: (see .env MAINTENANCE_PASSWORD)
```

**Features:**
- Toggle maintenance mode
- Control individual workers
- View advanced logs
- Monitor watchdog status
- See configuration
- Manage scheduled tasks

## 🔑 Using the CLI Tool

Install the CLI globally (optional):

```bash
npm install -g .
# or run directly with:
node bin/cli.js
```

### Common Commands

```bash
# Check status
node bin/cli.js status

# View logs
node bin/cli.js logs

# Restart server
node bin/cli.js restart

# Toggle maintenance mode
node bin/cli.js maintenance on
node bin/cli.js maintenance off

# Generate API key
node bin/cli.js api-keys generate

# Check health
node bin/cli.js health
```

## 🔐 Authentication

### Admin/Maintenance Panels
- **Default Username:** admin
- **Default Password:** Check `.env` file (ADMIN_PASSWORD, MAINTENANCE_PASSWORD)
- ⚠️ **Change these before production!**

### API Key Authentication
Generate and use API keys for programmatic access:

```bash
# Generate a new API key
curl -X POST http://localhost:3000/admin/api-keys/generate \
  -u admin:admin123 \
  -H "Content-Type: application/json" \
  -d '{"name":"my-app","scopes":["read"]}'

# Use the key for requests
curl http://localhost:3000/admin/metrics \
  -H "X-API-Key: sm_xxx...xxx"
```

## 📈 Monitoring & Metrics

### Prometheus Metrics Endpoint

```
http://localhost:3000/admin/metrics
```

Contains:
- Request counts by method/status
- Response time percentiles (p50, p95, p99)
- Worker memory usage
- Uptime and process info
- Cache hit/miss ratios

### Grafana Dashboard (Docker Compose only)

```
http://localhost:3001
```

- Pre-configured Prometheus datasource
- Real-time metrics visualization
- Customizable dashboards
- Default login: admin / admin

## 🔌 Plugin System

Create custom plugins in the `plugins/` directory:

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
      // Add custom middleware
      next();
    }];
  }

  getRoutes() {
    return [{
      path: '/my-route',
      handler: (req, res) => {
        res.json({ message: 'Hello from plugin' });
      },
    }];
  }

  getHealthChecks() {
    return [{
      name: 'plugin-check',
      check: async () => ({ status: 'healthy' }),
    }];
  }
}
```

Available example plugins:
- `plugins/request-logger/` - Logs all requests with timing
- `plugins/security-headers/` - Adds security headers to responses

## 📧 Email Alerts

Configure Resend API for email notifications:

```bash
# Set in .env
RESEND_API_KEY=re_xxxxx
ALERT_EMAIL=admin@example.com
```

Alerts sent for:
- Worker crashes
- Health check failures
- Crash loops
- Rolling restarts
- Maintenance mode changes

## 🔗 Webhooks & Multi-Channel Alerts

Configure webhooks for Slack, Discord, PagerDuty:

```bash
# .env configuration
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxx
PAGERDUTY_INTEGRATION_KEY=xxx
```

## 🛠️ Scheduled Tasks

Automatic tasks configured:

- **Log Rotation** (2 AM daily): Compress logs older than 100MB
- **Health Reports** (6 AM daily): Send summary email
- **Rolling Restarts** (2 AM daily): Gracefully restart workers

Customize in `src/utils/scheduled-tasks.js`

## 🧪 Testing

Run the test suite:

```bash
node tests/run.js
```

Example test file at `tests/suite.js` with:
- Configuration validation tests
- Health check tests
- Metrics collection tests
- API key validation tests
- Maintenance mode tests

## 🌐 SSL/TLS Support

Self-signed certificates auto-generated in `data/certs/`:

```bash
# Run with HTTPS
HTTPS_ENABLED=true npm start
```

Or create your own certificate:

```bash
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt -days 365 -nodes
```

## 📦 Systemd Installation (Production)

For Linux servers:

```bash
# Install as system service
sudo bash install.sh

# Start/stop/restart
sudo systemctl start sitemanager
sudo systemctl stop sitemanager
sudo systemctl restart sitemanager

# View logs
sudo journalctl -u sitemanager -f
```

## 🔄 Development vs Production

### Development Mode
```bash
npm run dev
```
- Single process (no clustering)
- Auto-reload on file changes
- Enhanced error logging
- Load testing endpoints enabled
- Detailed stack traces

### Production Mode
```bash
npm start
```
- Multi-process clustering
- Automatic crash recovery
- Watchdog monitoring
- Health checks
- Metrics collection
- Email alerts

## 📚 Full Documentation

For comprehensive feature documentation, see:
- [ADVANCED-FEATURES.md](./ADVANCED-FEATURES.md) - Detailed feature guide (2000+ lines)

## ⚠️ Important Security Notes

1. **Change default credentials** before production:
   - `ADMIN_PASSWORD`
   - `MAINTENANCE_PASSWORD`
   - `SITEMANAGER_API_KEY`

2. **Generate new API keys** for production deployments

3. **Use HTTPS** in production (enable `HTTPS_ENABLED=true`)

4. **Restrict admin panel access** using firewall rules in production

5. **Keep Node.js updated** for security patches

6. **Review plugin code** before enabling user-submitted plugins

## 🚨 Troubleshooting

### Server won't start
```bash
# Check logs
tail -f logs/sitemanager.log

# Check port is available
lsof -i :3000
```

### Metrics endpoint not working
```bash
# Verify ADMIN_API_KEY is set correctly
curl -H "X-API-Key: YOUR_KEY" http://localhost:3000/admin/metrics
```

### Plugins not loading
```bash
# Check plugin directory structure
ls -la plugins/your-plugin/index.js

# Check logs for errors
grep "plugin" logs/sitemanager.log
```

### Docker compose not starting
```bash
# Check service health
docker-compose ps

# View logs
docker-compose logs sitemanager

# Rebuild images
docker-compose build --no-cache
```

## 📞 Support & Resources

- GitHub Issues: [Link to your repo]
- Documentation: See ADVANCED-FEATURES.md
- Example Plugins: `plugins/` directory
- Test Examples: `tests/suite.js`

## 🎯 Next Steps

1. ✅ Add your website to `/website` directory
2. ✅ Update credentials in `.env`
3. ✅ Start server: `npm start` or `npm run dev`
4. ✅ Access admin panel: http://localhost:3000/admin
5. ✅ Configure alerts: Set ALERT_EMAIL and RESEND_API_KEY
6. ✅ (Optional) Deploy with Docker: `docker-compose up`
7. ✅ (Optional) Set up systemd: `sudo bash install.sh`

---

**Version:** 1.0.0  
**License:** MIT  
**Maintenance:** Active development
