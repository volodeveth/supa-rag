# AWS EC2 Migration Guide

## Architecture

```
GitHub (master) → GitHub Actions → EC2 t2.micro (Node.js + PM2)
                                   ├── Next.js standalone server (:3000)
                                   ├── Nginx reverse proxy (:80/:443)
                                   └── SSL via Let's Encrypt (Certbot)
```

## AWS Free Tier Limits

| Service | Free Limit | Our Usage |
|---------|-----------|-----------|
| EC2 t2.micro | 750 hrs/month (12 months) | ~730 hrs (1 instance 24/7) |
| EBS storage | 30 GB gp2/gp3 | ~8 GB needed |
| Data transfer | 100 GB/month out | Minimal (text chat app) |
| Elastic IP | Free while attached | 1 IP |

## Step 1: Launch EC2 Instance

1. Go to **AWS Console → EC2 → Launch Instance**
2. Settings:
   - **Name:** rag-chat
   - **AMI:** Ubuntu Server 24.04 LTS (free tier eligible)
   - **Instance type:** t2.micro
   - **Key pair:** Create new → download `.pem` file
   - **Security Group:** Create new with these rules:
     - SSH (22) — your IP only
     - HTTP (80) — anywhere
     - HTTPS (443) — anywhere
   - **Storage:** 8 GB gp3

3. **Allocate Elastic IP:**
   - EC2 → Elastic IPs → Allocate → Associate with your instance
   - Note the IP address

## Step 2: Setup Server

```bash
# SSH into the instance
ssh -i your-key.pem ubuntu@<elastic-ip>

# Upload and run setup script
scp -i your-key.pem scripts/ec2-setup.sh ubuntu@<elastic-ip>:~
ssh -i your-key.pem ubuntu@<elastic-ip> "sudo bash ~/ec2-setup.sh"
```

## Step 3: Configure Environment

```bash
ssh -i your-key.pem ubuntu@<elastic-ip>

# Create app directory
mkdir -p ~/rag-chat

# Create .env.production with your secrets
cat > ~/rag-chat/.env.production << 'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
JINA_API_KEY=your-jina-api-key
OPENROUTER_API_KEY=your-openrouter-api-key
EOF
```

## Step 4: Deploy

### Option A: Manual deploy

```bash
# From your local machine
bash scripts/deploy.sh ubuntu@<elastic-ip> ~/.ssh/your-key.pem
```

### Option B: GitHub Actions (recommended)

Add these secrets in **GitHub → Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|-------|
| `EC2_HOST` | Your Elastic IP |
| `EC2_USER` | `ubuntu` (or `ec2-user` for Amazon Linux) |
| `EC2_SSH_KEY` | Contents of your `.pem` file |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |

Push to `master` and the workflow will auto-deploy.

## Step 5: SSL Certificate (optional, requires domain)

```bash
sudo certbot --nginx -d your-domain.com
```

Certbot auto-renews via systemd timer.

## Verification

```bash
# Check app status
ssh -i your-key.pem ubuntu@<elastic-ip> "pm2 status"

# Check logs
ssh -i your-key.pem ubuntu@<elastic-ip> "pm2 logs rag-chat --lines 50"

# Test the app
curl http://<elastic-ip>

# Test SSE streaming
curl -N http://<elastic-ip>/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"test"}'
```

## Useful Commands

```bash
# View logs
pm2 logs rag-chat

# Restart app
pm2 restart rag-chat

# Monitor resources
pm2 monit

# Nginx logs
sudo tail -f /var/log/nginx/error.log
```

## Cost Summary

With free tier (first 12 months): **$0/month**

After free tier expires:
- t2.micro on-demand: ~$8.50/month
- Or use t4g.micro (ARM): ~$6/month
- Elastic IP: free while attached to running instance
