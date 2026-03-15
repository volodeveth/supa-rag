#!/bin/bash
set -euo pipefail

# =============================================================================
# Deploy script for RAG Chat → EC2
# Usage: bash scripts/deploy.sh <ec2-user@ec2-host> [ssh-key-path]
# Example: bash scripts/deploy.sh ec2-user@3.15.20.100 ~/.ssh/my-key.pem
# =============================================================================

EC2_HOST="${1:?Usage: deploy.sh <user@host> [ssh-key-path]}"
SSH_KEY="${2:-}"
REMOTE_DIR="/home/$(echo "$EC2_HOST" | cut -d@ -f1)/rag-chat"

SSH_OPTS="-o StrictHostKeyChecking=no"
if [ -n "$SSH_KEY" ]; then
  SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
fi

# ---------------------------------------------------------------------------
# 1. Build locally
# ---------------------------------------------------------------------------
echo ">>> Building Next.js standalone..."
npm run build

# ---------------------------------------------------------------------------
# 2. Prepare deployment package
# ---------------------------------------------------------------------------
echo ">>> Preparing deployment package..."
DEPLOY_DIR=".deploy-tmp"
rm -rf "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR/.next"
trap "rm -rf $DEPLOY_DIR" EXIT

cp -r .next/standalone/* "$DEPLOY_DIR/"
cp -r .next/standalone/.next/* "$DEPLOY_DIR/.next/"
cp -r .next/static "$DEPLOY_DIR/.next/static"
cp -r public "$DEPLOY_DIR/public" 2>/dev/null || true
cp ecosystem.config.js "$DEPLOY_DIR/"

# ---------------------------------------------------------------------------
# 3. Upload to EC2
# ---------------------------------------------------------------------------
echo ">>> Uploading to EC2..."
ssh $SSH_OPTS "$EC2_HOST" "rm -rf $REMOTE_DIR/app-tmp && mkdir -p $REMOTE_DIR/app-tmp"
scp -r $SSH_OPTS "$DEPLOY_DIR"/* "$EC2_HOST:$REMOTE_DIR/app-tmp/"
scp -r $SSH_OPTS "$DEPLOY_DIR"/.next "$EC2_HOST:$REMOTE_DIR/app-tmp/"
ssh $SSH_OPTS "$EC2_HOST" "cd $REMOTE_DIR && pm2 stop rag-chat 2>/dev/null; cp .env.production /tmp/.env.production.bak 2>/dev/null; rm -rf .next node_modules public server.js package.json ecosystem.config.js; cp -r app-tmp/. . && rm -rf app-tmp; cp /tmp/.env.production.bak .env.production 2>/dev/null"

# ---------------------------------------------------------------------------
# 4. Restart application
# ---------------------------------------------------------------------------
echo ">>> Restarting PM2..."
ssh $SSH_OPTS "$EC2_HOST" "cd $REMOTE_DIR && pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js"

echo ""
echo ">>> Deploy complete! App running at http://$( echo "$EC2_HOST" | cut -d@ -f2)"
