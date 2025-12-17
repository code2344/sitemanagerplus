#!/bin/bash

# SiteManager+ Installation Script
# Installs SiteManager+ as a systemd service

set -e

echo "🚀 Installing SiteManager+ as systemd service..."

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root"
   exit 1
fi

INSTALL_DIR="/opt/sitemanagerplus"
CONFIG_DIR="/etc/sitemanager"
USER="sitemanager"

# Create user
if ! id "$USER" &>/dev/null; then
    echo "Creating sitemanager user..."
    useradd -r -s /bin/bash -d /var/lib/sitemanager "$USER"
fi

# Create directories
echo "Creating directories..."
mkdir -p "$INSTALL_DIR"
mkdir -p "$CONFIG_DIR"
mkdir -p "/var/lib/sitemanager/data"
mkdir -p "/var/lib/sitemanager/logs"
mkdir -p "/var/lib/sitemanager/website"

# Install application
echo "Installing application files..."
cp -r src/ "$INSTALL_DIR/"
cp -r bin/ "$INSTALL_DIR/"
cp package.json "$INSTALL_DIR/"
cp package-lock.json "$INSTALL_DIR/"

# Install npm dependencies
echo "Installing dependencies..."
cd "$INSTALL_DIR"
npm ci --only=production

# Set permissions
echo "Setting permissions..."
chown -R "$USER:$USER" "$INSTALL_DIR"
chown -R "$USER:$USER" "/var/lib/sitemanager"
chmod 755 "$INSTALL_DIR"

# Create config file
echo "Creating configuration..."
cp .env.example "$CONFIG_DIR/sitemanager.env"
chmod 600 "$CONFIG_DIR/sitemanager.env"
chown "$USER:$USER" "$CONFIG_DIR/sitemanager.env"

# Install systemd service
echo "Installing systemd service..."
cp sitemanager.service /etc/systemd/system/
systemctl daemon-reload

# Install CLI
echo "Installing CLI..."
cp bin/cli.js /usr/local/bin/sitemanager
chmod +x /usr/local/bin/sitemanager

echo ""
echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Edit the configuration file:"
echo "   sudo nano $CONFIG_DIR/sitemanager.env"
echo ""
echo "2. Add your website files to:"
echo "   /var/lib/sitemanager/website/"
echo ""
echo "3. Start the service:"
echo "   sudo systemctl start sitemanager"
echo ""
echo "4. Enable auto-start:"
echo "   sudo systemctl enable sitemanager"
echo ""
echo "5. Check status:"
echo "   sudo systemctl status sitemanager"
echo ""
echo "6. View logs:"
echo "   sudo journalctl -u sitemanager -f"
echo ""
echo "7. Use CLI:"
echo "   sitemanager status"
echo "   sitemanager logs"
echo "   sitemanager restart"
