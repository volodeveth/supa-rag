# Ask About Dorosh — RAG Chat

## Project Overview
RAG chatbot built with Next.js 16, Supabase (pgvector), Jina AI, OpenRouter (DeepSeek). Ingests PDF/text documents, answers questions with hybrid search + SSE streaming.

## Tech Stack
- **Framework:** Next.js 16.1.6, React 19, TypeScript, Tailwind CSS v4
- **Database:** Supabase (PostgreSQL + pgvector + GIN full-text index)
- **Embeddings:** Jina Embeddings v3 (1024 dimensions)
- **Reranking:** Jina Reranker v3
- **LLM:** DeepSeek Chat via OpenRouter
- **Hosting:** Vercel Hobby (Fluid Compute, Node.js runtime; SSE works without Edge)
- **CI/CD:** Vercel Git integration (push to master → production deploy)
- **Scheduled jobs:** GitHub Actions `.github/workflows/cron.yml` (judge */15, alerts hourly)

## Live URLs
- **Production:** https://ask-about-dorosh-rag-chat.vercel.app
- **Legacy alias:** https://ask-about-dorosh.duckdns.org — same Vercel project (DuckDNS A → 76.76.21.21), kept alive for links in already-sent CVs; was AWS EC2 until 2026-10

## Deployment
- Push to `master` → Vercel builds and deploys. Manual: `vercel --prod`.
- Env vars live in Vercel project settings; `vercel env pull .env.local` to sync.
- Cron needs GitHub repo variable `BASE_URL` + secrets `EVAL_CRON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- Vercel Hobby crons run once a day max — that's why scheduling lives in GitHub Actions.

## Key Files

| File | Purpose |
|------|---------|
| `.github/workflows/cron.yml` | Scheduled judge + alerts |
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
- Chat API field is `query` (not `message`)
- `ingest-one.cjs` only appends: delete old rows for a `source` before re-ingesting it
