# SiteManager+ Production Deployment Checklist

Use this checklist before deploying SiteManager+ to production.

## ✅ Pre-Deployment Security

- [ ] **Change default credentials**
  ```bash
  # Generate strong passwords
  openssl rand -base64 32
  
  # Update in .env:
  # ADMIN_PASSWORD=<strong-password>
  # MAINTENANCE_PASSWORD=<strong-password>
  # SITEMANAGER_API_KEY=<strong-key>
  ```

- [ ] **Register hardware security keys**
  - Admin: `/admin` → Security → Register Hardware Key
  - Ops: `/maintenance` → Security → Register Hardware Key

- [ ] **Save SESSION_SECRET for OTP generation**
  ```bash
  # Save SESSION_SECRET from .env or data/session-secret
  cat data/session-secret
  # Store securely for offline OTP reset
  ```

- [ ] **Generate new API keys** for production services
  ```bash
  node bin/cli.js api-keys generate
  ```

- [ ] **Configure HTTPS/TLS**
  ```env
  HTTPS_ENABLED=true
  SSL_CERT_PATH=data/certs/server.crt
  SSL_KEY_PATH=data/certs/server.key
  ```

- [ ] **Enable security headers** (already configured)
  - Content-Security-Policy ✅
  - X-Frame-Options ✅
  - X-Content-Type-Options ✅
  - Strict-Transport-Security ✅

- [ ] **Configure firewall rules**
  - Block direct access to admin endpoints from outside trusted networks
  - Only expose port 3000 (or 443 for HTTPS) publicly
  - Restrict maintenance panel access

- [ ] **Review and update plugin security**
  - Audit all loaded plugins
  - Disable unused plugins
  - Update plugin dependencies

## ✅ Configuration

- [ ] **Update .env file**
  ```bash
  NODE_ENV=production
  WORKERS=4  # Match CPU core count
  PORT=3000
  STATIC_SITE_DIR=/website
  ```

- [ ] **Configure email alerts**
  ```env
  RESEND_API_KEY=<your-key>
  ALERT_EMAIL=admin@example.com
  ```

- [ ] **Configure webhooks (optional)**
  ```env
  SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
  DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
  PAGERDUTY_INTEGRATION_KEY=...
  ```

- [ ] **Set quiet hours** to reduce alert noise
  ```env
  QUIET_HOURS_START=22:00
  QUIET_HOURS_END=08:00
  QUIET_HOURS_ENABLED=true
  ```

- [ ] **Configure scheduled tasks**
  ```env
  ENABLE_LOG_ROTATION=true
  ENABLE_HEALTH_REPORTS=true
  LOG_ROTATION_TIME=02:00
  LOG_ROTATION_MAX_SIZE=100M
  ```

## ✅ File Management

- [ ] **Prepare website files**
  ```bash
  cp -r your-static-website/* website/
  # Verify all assets are in place
  ls -la website/
  ```

- [ ] **Verify static file structure**
  - [ ] index.html exists
  - [ ] CSS files served correctly
  - [ ] JavaScript files available
  - [ ] Images loading properly
  - [ ] No 404 errors in logs

- [ ] **Set up log directory with rotation**
  ```bash
  mkdir -p logs data/certs
  chmod 755 logs data
  ```

- [ ] **Create data directories**
  ```bash
  mkdir -p data/certs data/logs
  ```

## ✅ Dependencies & Updates

- [ ] **Install production dependencies**
  ```bash
  npm install --production
  npm prune
  ```

- [ ] **Check for security vulnerabilities**
  ```bash
  npm audit
  npm audit fix
  ```

- [ ] **Update to latest stable versions**
  ```bash
  npm update
  npm install
  ```

- [ ] **Verify Node.js version**
  ```bash
  node --version  # Should be 18 LTS or higher
  ```

## ✅ Testing

- [ ] **Run test suite**
  ```bash
  node tests/run.js
  ```

- [ ] **Load test the server**
  ```bash
  # In development mode:
  NODE_ENV=development node bin/cli.js status
  # Then test with:
  curl http://localhost:3000/test/load-test?duration=30
  ```

- [ ] **Test admin panels**
  - [ ] Admin dashboard loads
  - [ ] Metrics display correctly
  - [ ] API keys can be generated
  - [ ] Health checks pass

- [ ] **Test maintenance mode**
  ```bash
  node bin/cli.js maintenance on
  # Verify page shows maintenance message
  node bin/cli.js maintenance off
  ```

- [ ] **Test email alerts**
  - [ ] Generate test email in logs
  - [ ] Verify delivery to ALERT_EMAIL
  - [ ] Check formatting

- [ ] **Test backups**
  ```bash
  # Verify data directory can be backed up
  tar -czf backup.tar.gz data/
  ```

## ✅ Deployment Options

### Option A: Docker Compose (Recommended)

- [ ] **Build Docker image**
  ```bash
  docker-compose build
  ```

- [ ] **Test in Docker**
  ```bash
  docker-compose up
  # Test: curl http://localhost:3000
  docker-compose down
  ```

- [ ] **Deploy to production**
  ```bash
  docker-compose -f docker-compose.yml up -d
  ```

- [ ] **Configure Docker resources**
  - [ ] Set memory limits in docker-compose.yml
  - [ ] Set CPU limits appropriately
  - [ ] Configure restart policy (always)

### Option B: Systemd (Linux)

- [ ] **Prepare system user**
  ```bash
  sudo useradd -r -s /bin/false sitemanager || true
  ```

- [ ] **Copy files to production directory**
  ```bash
  sudo mkdir -p /opt/sitemanager
  sudo cp -r . /opt/sitemanager/
  sudo chown -R sitemanager:sitemanager /opt/sitemanager
  ```

- [ ] **Install systemd service**
  ```bash
  sudo bash install.sh
  ```

- [ ] **Enable and start service**
  ```bash
  sudo systemctl enable sitemanager
  sudo systemctl start sitemanager
  ```

- [ ] **Verify service status**
  ```bash
  sudo systemctl status sitemanager
  sudo journalctl -u sitemanager -n 50
  ```

### Option C: PM2 (Node Process Manager)

- [ ] **Install PM2**
  ```bash
  npm install -g pm2
  ```

- [ ] **Create PM2 config**
  ```bash
  cat > ecosystem.config.js << 'EOF'
  module.exports = {
    apps: [{
      name: 'sitemanager',
      script: './src/index.js',
      instances: 4,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
    }]
  };
  EOF
  ```

- [ ] **Start with PM2**
  ```bash
  pm2 start ecosystem.config.js
  pm2 startup
  pm2 save
  ```

## ✅ Network & Load Balancing

- [ ] **Configure reverse proxy** (nginx/Apache)
  ```nginx
  server {
    listen 80;
    server_name example.com;
    
    location / {
      proxy_pass http://localhost:3000;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }
  ```

- [ ] **Set up SSL termination**
  - [ ] Use certbot for Let's Encrypt certificates
  - [ ] Configure auto-renewal
  - [ ] Point to SiteManager+ backend

- [ ] **Configure DNS**
  - [ ] Point domain to server IP
  - [ ] Verify DNS resolution
  - [ ] Test with nslookup/dig

- [ ] **Test reverse proxy**
  ```bash
  curl -H "Host: example.com" http://localhost/
  ```

## ✅ Monitoring & Logging

- [ ] **Set up log rotation**
  ```bash
  # Verify logs rotate daily at 2 AM
  ls -la logs/
  ```

- [ ] **Monitor disk usage**
  ```bash
  df -h
  du -sh logs/
  ```

- [ ] **Set up Prometheus monitoring** (if using Docker)
  - [ ] Prometheus scrapes metrics every 10 seconds
  - [ ] Grafana accesses Prometheus data
  - [ ] Dashboards display correctly

- [ ] **Configure alerting**
  - [ ] Slack/Discord webhooks active
  - [ ] Email alerts working
  - [ ] Test alert routing

- [ ] **Set up log aggregation** (optional)
  - [ ] Logs ship to centralized system
  - [ ] Search functionality available
  - [ ] Retention policy configured

## ✅ Backup & Recovery

- [ ] **Create backup script**
  ```bash
  #!/bin/bash
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  tar -czf backups/sitemanager_${TIMESTAMP}.tar.gz \
    website/ \
    data/
  ```

- [ ] **Schedule automatic backups**
  ```bash
  # Add to crontab
  0 */6 * * * /opt/sitemanager/backup.sh
  ```

- [ ] **Test backup restoration**
  - [ ] Create backup
  - [ ] Delete a file
  - [ ] Restore from backup
  - [ ] Verify integrity

- [ ] **Document recovery procedures**
  - [ ] Steps to restore from backup
  - [ ] Contact information for on-call
  - [ ] RTO/RPO targets

## ✅ Performance Tuning

- [ ] **Optimize Node.js settings**
  ```bash
  # Set heap size if needed
  export NODE_OPTIONS="--max-old-space-size=1024"
  ```

- [ ] **Configure worker count**
  ```env
  # Set to number of CPU cores
  WORKERS=4
  ```

- [ ] **Enable compression**
  ```env
  # Already enabled by default
  GZIP_ENABLED=true
  ```

- [ ] **Monitor and optimize caching**
  - [ ] Review cache hit rates
  - [ ] Adjust cache headers as needed
  - [ ] Monitor browser cache effectiveness

## ✅ Documentation

- [ ] **Create runbook**
  - [ ] Standard operating procedures
  - [ ] Emergency contacts
  - [ ] Escalation procedures
  - [ ] Common issues and solutions

- [ ] **Document custom configuration**
  - [ ] Any modified defaults
  - [ ] Credentials (securely stored)
  - [ ] Deployed environment specifics

- [ ] **Create architecture diagram**
  - [ ] Network topology
  - [ ] Services and dependencies
  - [ ] Data flow

- [ ] **Document plugins**
  - [ ] List of active plugins
  - [ ] Plugin purposes
  - [ ] Custom configurations

## ✅ Go-Live

- [ ] **Pre-flight checks**
  ```bash
  # Verify all systems operational
  node bin/cli.js status
  node bin/cli.js health
  curl http://localhost:3000/
  ```

- [ ] **Brief team on deployment**
  - [ ] Review changes
  - [ ] Confirm rollback plan
  - [ ] Verify communication channels

- [ ] **Deploy during low-traffic window**
  - [ ] Avoid peak hours
  - [ ] Have team available
  - [ ] Monitor closely

- [ ] **Monitor closely after deployment**
  - [ ] Watch error logs
  - [ ] Check memory/CPU usage
  - [ ] Verify user traffic
  - [ ] Monitor alert channels

- [ ] **Post-deployment validation**
  ```bash
  # Test critical paths
  curl -v http://example.com/
  node bin/cli.js status
  node bin/cli.js logs
  ```

## ✅ Post-Deployment

- [ ] **Monitor for 24 hours**
  - [ ] Check logs regularly
  - [ ] Verify metrics are normal
  - [ ] Confirm no alert spikes

- [ ] **Document any issues encountered**
  - [ ] Note problems and solutions
  - [ ] Update runbook
  - [ ] Share learnings with team

- [ ] **Schedule follow-up review**
  - [ ] Performance analysis
  - [ ] Cost optimization
  - [ ] Security audit

- [ ] **Set up on-call rotation**
  - [ ] Define on-call schedule
  - [ ] Distribute pager access
  - [ ] Test alert delivery

## 🚨 Emergency Procedures

### If Server Crashes

1. Check logs: `journalctl -u sitemanager -n 100`
2. Restart: `sudo systemctl restart sitemanager`
3. Verify: `sudo systemctl status sitemanager`
4. Check metrics: `curl http://localhost:3000/admin/metrics`

### If Admin Panel Unreachable

1. SSH to server
2. Check port: `lsof -i :3000`
3. Check process: `ps aux | grep node`
4. Check logs: `tail -f logs/sitemanager.log`
5. Restart if needed: `npm start` or `systemctl restart sitemanager`

### If Out of Disk Space

1. Check disk: `df -h`
2. Find large files: `du -sh logs/*`
3. Rotate/delete old logs: `rm logs/sitemanager.*.gz`
4. Check database size: `du -sh data/`

### If High CPU/Memory

1. Check processes: `top -b -n 1 | head -20`
2. Check logs for errors
3. Review recent changes
4. Consider scaling up resources
5. Run load testing to identify issue

## 📞 Support Contacts

- **On-Call Engineer:** [Contact Info]
- **System Administrator:** [Contact Info]
- **Security Team:** [Contact Info]
- **Incident Commander:** [Contact Info]

---

**Last Updated:** 2024  
**Deployment Version:** 1.0.0  
**Review Frequency:** Before each deployment
