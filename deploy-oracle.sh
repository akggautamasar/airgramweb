#!/usr/bin/env bash
set -euo pipefail

echo "=== AirGram Web — Oracle Cloud (Ubuntu) Setup ==="

if [ ! -f ".env" ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
  echo "IMPORTANT: Edit .env and set TG_API_ID, TG_API_HASH, and APP_SECRET before starting!"
fi

# Install Node.js 20 if missing
if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# Install PM2 globally if missing
if ! command -v pm2 >/dev/null 2>&1; then
  echo "Installing PM2..."
  sudo npm install -g pm2
fi

echo "Installing server & client dependencies..."
npm run setup

echo "Building frontend..."
npm run build

echo "Starting AirGram with PM2..."
pm2 delete airgram-web >/dev/null 2>&1 || true
pm2 start server/index.js --name airgram-web
pm2 save

echo ""
echo "Done! AirGram is running on port 3000."
echo "Oracle Cloud Checklist:"
echo "  1. Open port 80/443 (or 3000) in OCI VCN Security List -> Ingress Rules."
echo "  2. If using Ubuntu iptables on Oracle Cloud, run:"
echo "     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT"
echo "     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT"
echo "     sudo netfilter-persistent save"
echo "  3. Copy nginx.conf.example to /etc/nginx/sites-available/airgram and reload nginx."
