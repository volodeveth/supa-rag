#!/bin/bash
set -euo pipefail

# =============================================================================
# EC2 Setup Script for RAG Chat (Amazon Linux 2023 / Ubuntu 24.04)
# Run as: sudo bash ec2-setup.sh
# =============================================================================

echo ">>> Detecting OS..."
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="$ID"
else
  echo "Cannot detect OS. Exiting."
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. System updates
# ---------------------------------------------------------------------------
echo ">>> Updating system packages..."
if [[ "$OS_ID" == "amzn" ]]; then
  dnf update -y
elif [[ "$OS_ID" == "ubuntu" ]]; then
  apt-get update && apt-get upgrade -y
fi

# ---------------------------------------------------------------------------
# 2. Install Node.js 20 LTS
# ---------------------------------------------------------------------------
echo ">>> Installing Node.js 20 LTS..."
if [[ "$OS_ID" == "amzn" ]]; then
  dnf install -y nodejs20 npm
elif [[ "$OS_ID" == "ubuntu" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

node --version
npm --version

# ---------------------------------------------------------------------------
# 3. Install PM2
# ---------------------------------------------------------------------------
echo ">>> Installing PM2..."
npm install -g pm2
pm2 startup systemd -u "$SUDO_USER" --hp "/home/$SUDO_USER"

# ---------------------------------------------------------------------------
# 4. Install Nginx
# ---------------------------------------------------------------------------
echo ">>> Installing Nginx..."
if [[ "$OS_ID" == "amzn" ]]; then
  dnf install -y nginx
elif [[ "$OS_ID" == "ubuntu" ]]; then
  apt-get install -y nginx
fi

# ---------------------------------------------------------------------------
# 5. Configure Nginx reverse proxy
# ---------------------------------------------------------------------------
echo ">>> Configuring Nginx..."
cat > /etc/nginx/conf.d/rag-chat.conf << 'NGINX'
server {
    listen 80;
    server_name _;

    # SSE streaming support
    proxy_buffering off;
    proxy_cache off;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE-specific: disable buffering and timeouts
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
NGINX

# Remove default config if it conflicts
if [[ "$OS_ID" == "ubuntu" ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl enable nginx
systemctl restart nginx

# ---------------------------------------------------------------------------
# 6. Install Certbot (SSL)
# ---------------------------------------------------------------------------
echo ">>> Installing Certbot..."
if [[ "$OS_ID" == "amzn" ]]; then
  dnf install -y certbot python3-certbot-nginx
elif [[ "$OS_ID" == "ubuntu" ]]; then
  apt-get install -y certbot python3-certbot-nginx
fi

echo ""
echo "============================================="
echo "  Setup complete!"
echo "============================================="
echo ""
echo "Next steps:"
echo "  1. Copy your app to /home/$SUDO_USER/rag-chat/"
echo "  2. Create /home/$SUDO_USER/rag-chat/.env.production with your secrets"
echo "  3. Run: cd /home/$SUDO_USER/rag-chat && pm2 start ecosystem.config.js"
echo "  4. For SSL: sudo certbot --nginx -d your-domain.com"
echo ""
