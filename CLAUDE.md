# Ask About Dorosh — RAG Chat

## Project Overview
RAG chatbot built with Next.js 16, Supabase (pgvector), Jina AI, OpenRouter (DeepSeek). Ingests PDF/text documents, answers questions with hybrid search + SSE streaming.

## Tech Stack
- **Framework:** Next.js 16.1.6, React 19, TypeScript, Tailwind CSS v4
- **Database:** Supabase (PostgreSQL + pgvector + GIN full-text index)
- **Embeddings:** Jina Embeddings v3 (1024 dimensions)
- **Reranking:** Jina Reranker v3
- **LLM:** DeepSeek Chat via OpenRouter
- **Hosting:** AWS EC2 t2/t3.micro (free tier)
- **Process Manager:** PM2
- **Reverse Proxy:** Nginx with SSE support
- **SSL:** Let's Encrypt (Certbot, auto-renewal)
- **CI/CD:** GitHub Actions (push to master → deploy to EC2)

## Live URLs
- **Production:** https://ask-about-dorosh.duckdns.org
- **Legacy (Vercel):** https://ask-about-dorosh-rag-chat.vercel.app/

## Infrastructure — AWS EC2

```
GitHub (master) → GitHub Actions → EC2 t3.micro
                                   ├── Next.js standalone server (:3000)
                                   ├── Nginx reverse proxy (:80/:443)
                                   └── SSL via Let's Encrypt (Certbot)
```

- **Instance:** t3.micro (2 vCPU, 1 GB RAM), Ubuntu 24.04 LTS
- **IP:** 13.63.225.134 (Elastic IP)
- **Domain:** ask-about-dorosh.duckdns.org (DuckDNS, free)
- **SSH:** `ssh -i ~/.ssh/rag-chat-key1.pem ubuntu@13.63.225.134`
- **App directory on server:** `/home/ubuntu/rag-chat/`
- **Env vars on server:** `/home/ubuntu/rag-chat/.env.production`

## Deployment

### Manual deploy
```bash
bash scripts/deploy.sh ubuntu@13.63.225.134 ~/.ssh/rag-chat-key1.pem
```

### Auto deploy
Push to `master` → GitHub Actions builds and deploys automatically.

### Required GitHub Secrets
- `EC2_HOST` — Elastic IP
- `EC2_USER` — `ubuntu`
- `EC2_SSH_KEY` — contents of `.pem` file
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Key Files

| File | Purpose |
|------|---------|
| `next.config.ts` | `output: "standalone"` for minimal deploy (~30MB) |
| `ecosystem.config.js` | PM2 config, loads `.env.production` |
| `scripts/ec2-setup.sh` | Server provisioning (Node.js, PM2, Nginx, Certbot) |
| `scripts/deploy.sh` | Manual deploy via scp + SSH |
| `.github/workflows/deploy.yml` | CI/CD pipeline |
| `src/app/api/chat/route.ts` | Chat API endpoint (SSE streaming) |
| `src/components/Chat.tsx` | Chat UI component |
| `src/lib/` | Embeddings, LLM, reranker, chunker, supabase client |
| `scripts/ingest-pdf.mjs` | Document ingestion script |

## Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
JINA_API_KEY
OPENROUTER_API_KEY
```

## Server Commands
```bash
pm2 status                    # app status
pm2 logs rag-chat             # live logs
pm2 restart rag-chat          # restart
pm2 delete rag-chat && pm2 start ecosystem.config.js  # full restart with env reload
sudo nginx -t && sudo systemctl reload nginx           # reload nginx
sudo certbot renew            # renew SSL (auto via systemd timer)
```

## Data Ingestion

### Scripts
| Script | Purpose |
|--------|---------|
| `scripts/collect-projects.mjs` | Scans 16 project dirs, extracts README/package.json/docs → `scripts/project-docs/*.txt` |
| `scripts/ingest-one.cjs` | Ingests single .txt file into Supabase (lightweight, no SDK) |
| `scripts/ingest-projects.sh` | Wrapper: runs `ingest-one.cjs` for each file in `project-docs/` |
| `scripts/ingest-pdf.mjs` | Original CV ingestion script (has chunkText bug — see below) |

### How to re-ingest projects
```bash
node scripts/collect-projects.mjs          # 1. Collect docs
# Review scripts/project-docs/*.txt        # 2. Check for secrets
bash scripts/ingest-projects.sh            # 3. Ingest into Supabase
```

### Source naming convention
- CV data: `source: "cv.pdf"` / `"cv-text.txt"`
- Project data: `source: "project:<name>"` (e.g. `"project:nifta"`)

### Known issues
- **Do NOT use `@supabase/supabase-js` in ingest scripts** — causes OOM (~2GB). Use direct `fetch()` to Supabase REST API
- **Do NOT use `.mjs` for ingest scripts** — Node 22 + dotenv v17 ESM loader causes OOM. Use `.cjs`
- **`chunkText()` infinite loop bug** in `ingest-pdf.mjs` / `ingest.mjs`: when last chunk ≤ CHUNK_OVERLAP, `start` never advances. Fixed in `ingest-one.cjs`

## Important Notes
- `ecosystem.config.js` reads `.env.production` at startup — PM2 must be `delete` + `start` (not just `restart`) to reload env vars
- Deploy script preserves `.env.production` on server during redeployment
- Nginx configured with `proxy_buffering off` for SSE streaming support
- Chat API field is `query` (not `message`)
- SSL cert auto-renews, expires 2026-06-13
