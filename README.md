# SiteManager+ - Ultra Fault-Tolerant Static Website Server

Production-grade Node.js server runtime for serving static websites with maximum uptime, zero-downtime deployments, and automatic self-healing.

## ✨ Key Features

- **Multi-Worker Cluster**: Node.js cluster with automatic worker recovery
- **Zero-Downtime Restarts**: Graceful rolling restarts maintain availability
- **Watchdog System**: Automatic detection and recovery of crashed or hung workers
- **Persistent Maintenance Mode**: System-wide maintenance without process restart
- **Admin & Ops Panels**: Built-in control panels for site management
- **Health Monitoring**: Real-time worker health tracking and metrics
- **Hot Reload**: Automatic detection of file changes
- **Email Alerts**: Integration with Resend for critical notifications
- **Security**: Authentication, rate limiting, path traversal protection, **WebAuthn hardware keys**
- **Performance**: Compression, intelligent caching, CDN-ready headers
- **Control Panel Features**: 20+ admin endpoints, 20+ ops endpoints (see `ADVANCED-FEATURES.md`)
- **OTP Reset**: Offline OTP generator for hardware key resets

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm

### Installation

```bash
# Clone or setup the project
cd sitemanagerplus

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your settings (especially admin passwords!)
# nano .env

# Start the server
npm start
```

The server will start on `http://localhost:3000` by default.

## 📁 File Structure

```
sitemanagerplus/
├── website/                 # ← Add your HTML files here!
│   └── index.html          # Default welcome page
├── src/
│   ├── index.js            # Entry point
│   ├── cluster/
│   │   ├── master.js       # Master process controller
│   │   ├── worker.js       # Worker HTTP server
│   │   └── static-server.js # Static file serving
│   ├── watchdog/
│   │   └── coordinator.js  # Health monitoring and recovery
│   ├── health/
│   │   └── monitor.js      # Health check system
│   ├── maintenance/
│   │   └── manager.js      # Maintenance mode
│   ├── email/
│   │   └── alerts.js       # Email notifications
│   ├── panels/
│   │   ├── admin.js        # Admin control panel
│   │   └── maintenance.js  # Ops control panel
│   ├── watchers/
│   │   └── file-watcher.js # File change detection
│   └── utils/
│       ├── config.js       # Configuration management
│       ├── auth.js         # Authentication middleware
│       └── logger.js       # Logging system
├── data/                   # Persistent data
├── logs/                   # Server logs
├── maintenance/            # Maintenance page files
├── .env.example           # Configuration template
└── package.json           # Dependencies
```

## 🌐 Access Points

### Public Site
- **URL**: `http://localhost:3000`
- **Files**: Served from `/website` directory
- **Caching**: Intelligent headers for browser caching

### Admin Panel
- **URL**: `http://localhost:3000/admin`
- **Auth**: Password (first time) → **Hardware security key required**
- **Default**: Username `admin` / Password `changeme123`
- **Features**:
  - System status and worker health
  - Toggle maintenance mode
  - View logs
  - Restart information
  - Backups, SSL, API keys, plugins, metrics, audit logs, webhooks, scheduled tasks, and more (20+ endpoints)
  - Register/Reset hardware security key

### Operations Panel
- **URL**: `http://localhost:3000/maintenance`
- **Auth**: Password (first time) → **Hardware security key required**
- **Default**: Username `ops` / Password `changeme456`
- **Features**:
  - Graceful rolling restarts
  - Individual worker control
  - Real-time monitoring
  - Advanced logging and diagnostics
  - Force maintenance mode

## ⚙️ Configuration (.env)

### Server
```env
PORT=3000                          # Server port
NODE_ENV=production                # Environment
STATIC_SITE_DIR=./website          # Website directory
```

### Authentication
```env
ADMIN_USERNAME=admin               # Admin panel username
ADMIN_PASSWORD=changeme123         # Admin panel password (CHANGE THIS!)
MAINTENANCE_USERNAME=ops           # Ops panel username
MAINTENANCE_PASSWORD=changeme456   # Ops panel password (CHANGE THIS!)
```

### Clustering
```env
WORKER_COUNT=4                     # Number of worker processes
MEMORY_THRESHOLD_MB=256            # Memory limit per worker
HEARTBEAT_INTERVAL_MS=5000         # Health check interval
HEARTBEAT_TIMEOUT_MS=15000         # Heartbeat timeout
RESTART_THRESHOLD=5                # Crash loop threshold
RESTART_WINDOW_MS=60000            # Crash loop window
```

### Email Alerts (Resend)
```env
RESEND_API_KEY=re_your_key_here    # Resend API key (optional)
ADMIN_EMAIL=admin@example.com      # Admin email
ALERT_EMAILS=admin@example.com,ops@example.com
```

## 📊 Monitoring & Management

### View System Status
```bash
curl -u admin:changeme123 http://localhost:3000/admin/status
```

### Get Worker Information
```bash
curl -u admin:changeme123 http://localhost:3000/admin/workers
```

### View Logs
```bash
tail -f logs/app.log
tail -f logs/error.log
tail -f logs/http.log
```

### Trigger Rolling Restart
```bash
curl -u ops:changeme456 -X POST http://localhost:3000/maintenance/restart/rolling \
  -H "Content-Type: application/json" \
  -d '{"reason": "Configuration update"}'
```

### Toggle Maintenance Mode
```bash
curl -u admin:changeme123 -X POST http://localhost:3000/admin/maintenance/toggle \
  -H "Content-Type: application/json" \
  -d '{"reason": "Scheduled maintenance", "durationMinutes": 30}'
```

## 🛡️ Security

### Important
1. **Change default credentials** in `.env` before production deployment
2. **Admin and maintenance routes** are always accessible, even during maintenance
3. **Rate limiting** on authentication endpoints prevents brute force attacks
4. **Path traversal protection** on static file serving
5. **HTTPS recommended** in production (use reverse proxy like nginx)

### Best Practices
- Use strong, unique passwords
- Rotate credentials regularly
- Monitor logs for suspicious activity
- Use environment variables for sensitive data
- Deploy behind a reverse proxy (nginx, Cloudflare)
- Enable HTTPS/TLS
- Set up email alerts for critical events

## 🔄 How It Works

### Master Process
- Manages worker processes
- Monitors worker health via heartbeats
- Detects crashed or hung workers
- Triggers automatic recovery
- Coordinates graceful rolling restarts
- Watches for file changes

### Worker Processes
- Handle HTTP requests
- Serve static files
- Report health metrics
- Support graceful shutdown
- Handle maintenance mode
- Compress responses

### Watchdog System
- Detects missing heartbeats
- Monitors memory usage
- Tracks error rates
- Prevents crash loops
- Automatically restarts unhealthy workers
- Activates maintenance mode if critical

### Graceful Rolling Restart
1. Mark worker as draining
2. Stop accepting new connections
3. Wait for existing requests to complete (with timeout)
4. Shut down worker
5. Spawn replacement worker
6. Repeat for next worker
7. Maintain at least one healthy worker at all times

## 📝 Adding Your Site

1. Remove or replace `/website/index.html`
2. Add your HTML, CSS, and JavaScript files to `/website`
3. Files are automatically detected and served
4. Refresh your browser to see changes
5. Access your site at `http://localhost:3000`

### Example
```bash
# Add your files
cp my-site/* ./website/

# Or create new files
echo "<h1>Hello</h1>" > website/hello.html
```

Visit `http://localhost:3000` and the files will be automatically served.

## 📈 Performance Tips

### Caching
- Static assets (CSS, JS, images) cached for 1 year
- HTML files cached with ETags for validation
- Set `Cache-Control` headers appropriately

### Compression
- GZIP compression enabled by default
- Images and video files not re-compressed
- Threshold: 1KB minimum for compression

### Worker Count
- Default: CPU count / 2
- Increase for high-traffic sites
- Monitor memory usage per worker

## 🐛 Troubleshooting

### Server Won't Start
```bash
# Check if port is in use
lsof -i :3000

# Check logs
tail -f logs/error.log
```

### Workers Crashing
```bash
# Check worker logs
tail -f logs/app.log

# Check system health
curl -u admin:changeme123 http://localhost:3000/admin/status
```

### Authentication Issues
```bash
# Verify credentials in .env
cat .env | grep ADMIN_

# Test basic auth
curl -u admin:changeme123 http://localhost:3000/admin

# Hardware key reset (if locked out)
# 1. Get SESSION_SECRET from .env or data/session-secret
# 2. Run OTP generator:
./bin/otp.sh <SESSION_SECRET>
# 3. Use OTP to reset hardware key via admin/maintenance panel
```

### File Changes Not Detected
- Check file permissions
- Verify file is in `/website` directory
- Restart workers with rolling restart
- Check logs for watcher errors

## 📞 Support & Monitoring

### Logs Location
- `logs/app.log` - General application logs
- `logs/error.log` - Error logs
- `logs/http.log` - HTTP request logs
- `logs/debug.log` - Debug information

### Email Alerts
- Worker crashes
- Crash loop detection
- Rolling restart events
- Maintenance mode changes
- System health degradation

### Health Endpoints (Admin Only)
- `GET /admin` - Dashboard
- `GET /admin/status` - System status
- `GET /admin/workers` - Worker details
- `GET /admin/health` - Quick health check
- `POST /admin/logs` - Retrieve logs

## 🚀 Production Deployment

### Checklist
- [ ] Change all default credentials
- [ ] Register hardware keys for admin and ops
- [ ] Set `NODE_ENV=production`
- [ ] Configure email alerts with Resend API key
- [ ] Set appropriate worker count
- [ ] Configure memory thresholds
- [ ] Deploy behind reverse proxy (nginx/Cloudflare)
- [ ] Enable HTTPS/TLS
- [ ] Set up monitoring and alerting
- [ ] Test graceful restarts
- [ ] Document maintenance procedures
- [ ] Save SESSION_SECRET for offline OTP generation

### Recommended Setup
```
Internet → HTTPS (nginx/Cloudflare) → 
  → SiteManager+ (localhost:3000) ← Reverse Proxy
```

## 📄 License

MIT

## 🙏 Built with

- Node.js
- Express.js
- Chokidar
- Resend API
- Native clustering

---

**SiteManager+** - Production-grade, ultra fault-tolerant static website server
