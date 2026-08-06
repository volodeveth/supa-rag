# Ask About Dorosh — RAG Chat

> **Live:** [ask-about-dorosh.duckdns.org](https://ask-about-dorosh.duckdns.org/)

Production-grade Retrieval-Augmented Generation chatbot. Ingests PDF/text documents, indexes source code and docs from 34 projects (3,364 chunks), and answers questions using hybrid vector + full-text search with real-time SSE streaming.

Every request is traced: per-stage latency, retrieval quality, token cost, and an
asynchronous LLM-as-a-judge score. See [Observability & Evaluation](#observability--evaluation).

## How It Works

```
PDF/Text → Chunk → Jina Embed (1024d) → Supabase pgvector
                                              ↓
User query → Embed → Hybrid Search (vector + BM25) → RRF Fusion → Jina Rerank → DeepSeek V4 Pro → SSE Stream
                                              ↓
                                    Trace → Postgres → /analytics → LLM judge (async)
```

1. **Document ingestion** — splits text into overlapping chunks, generates 1024-dimensional vector embeddings via Jina Embeddings v3, stores in Supabase (PostgreSQL + pgvector)
2. **Hybrid search** — combines vector similarity search with full-text search (GIN index, BM25) using Reciprocal Rank Fusion (RRF)
3. **Reranking** — Jina Reranker v3 scores and filters the top results for relevance
4. **Answer generation** — DeepSeek V4 Pro (via OpenRouter) generates a streamed response grounded in the retrieved context
5. **Tracing** — the request is written to `chat_traces` with stage timings, retrieval scores, token counts and the provider-reported cost; a cron-driven judge scores it afterwards, off the hot path

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS v4 |
| **Database** | Supabase (PostgreSQL + pgvector + GIN full-text index) |
| **Embeddings** | Jina Embeddings v3 (1024 dimensions) |
| **Reranking** | Jina Reranker v3 |
| **LLM** | DeepSeek V4 Pro via OpenRouter (reasoning disabled; swap via `GENERATOR_MODEL`) |
| **Eval judge** | Gemma 4 / Qwen3 via OpenRouter — deliberately not the generator |
| **Observability** | Postgres trace table + SQL views, `/analytics` dashboard, Telegram alerts |
| **Hosting** | AWS EC2 (t3.micro, Ubuntu 24.04) |
| **Process Manager** | PM2 (cluster mode) |
| **Reverse Proxy** | Nginx with SSE support |
| **SSL** | Let's Encrypt (Certbot, auto-renewal) |
| **CI/CD** | GitHub Actions (push to master → auto-deploy) |
| **Build** | Next.js standalone output (~30MB) |

## Architecture

```
GitHub (master push)
    ↓
GitHub Actions CI/CD
    ↓
AWS EC2 t3.micro
├── Next.js standalone server (:3000)
├── Nginx reverse proxy (:80/:443)
├── SSL via Let's Encrypt (Certbot)
└── PM2 process manager
```

## Observability & Evaluation

Off-the-shelf metric stacks do not answer the questions a RAG system actually
raises — what an answer cost, whether it was grounded, how often retrieval came
back empty. Those are per-request, high-cardinality facts, so they live as rows
in Postgres rather than as time series, and the dashboard is a page over SQL views.

### What every request records

`chat_traces` stores one row per query:

| Group | Fields |
|---|---|
| **Latency** | `embedding_ms`, `search_ms`, `rerank_ms`, `llm_ttfb_ms`, `llm_total_ms`, `total_ms` |
| **Retrieval quality** | `chunks_found`, `chunks_reranked`, `top_relevance_score`, `avg_relevance_score` |
| **Cost** | per-provider token counts + `cost_usd`, taken from the provider's reported cost |
| **Outcome** | `status`, `error_step`, `error_message`, `is_no_answer`, `feedback` |
| **Provenance** | `generator_model`, `embedding_model`, `reranker_model`, `prompt_version` |
| **Privacy** | `user_agent`, `ip_hash` — IPs are hashed, never stored raw |

`prompt_version` is a fingerprint of the system prompt text, computed at runtime:
edit the prompt and the version changes on its own. Without provenance a drop in
quality cannot be attributed to a change — you see the metric move but not why.

### Aggregation

Two views do the work, so the dashboard stays a thin reader:

- `chat_analytics_daily` — per day: exact `percentile_cont` p50/p95/p99, error rate, no-answer rate, empty-retrieval rate, cost, judge averages
- `chat_analytics_by_config` — the same columns grouped by pipeline configuration instead of by day: one row per A/B arm
- `chat_relevance_histogram` — distribution of `top_relevance_score` in 0.2 buckets

### LLM-as-a-judge

`POST /api/evaluate` scores unjudged traces on four RAGAS-style axes —
faithfulness, answer relevance, context relevance, context sufficiency — plus a
short rationale.

- The judge is **deliberately a different model from the generator**, so it cannot mark its own homework.
- It walks a fallback chain, moving on when a model 404s, rate-limits or returns unusable output. Free model slugs get retired without notice; a single judge is a single point of failure.
- It runs from cron, off the request path, so evaluation adds no user-visible latency.
- `eval_judge_model` records which model actually scored each trace.

```bash
EVAL_CRON_KEY=... BASE_URL=https://... node scripts/run-eval.cjs
```

### Alerts

The dashboard cannot report that the service is down, because a dead service
writes no traces. `scripts/check-alerts.cjs` runs outside the app and checks p95,
cost per query, faithfulness, no-answer rate, error rate and evaluation backlog —
plus a dead-man's switch on trace silence. Breaches go to Telegram.

```bash
node scripts/check-alerts.cjs   # thresholds via ALERT_* env vars
```

### Dashboard

`/analytics` — volume, latency, cost, quality, relevance histogram, daily
breakdown and recent traces, with `/analytics/[traceId]` for a single request.
Behind a middleware auth cookie.

## Data Pipeline

| Script | Purpose |
|--------|---------|
| `scripts/collect-projects.mjs` | Scans project directories, extracts README/package.json/docs |
| `scripts/collect-projects-2026.mjs` | Current collector — 18 curated project docs |
| `scripts/ingest-one.cjs` | Ingests a single .txt file into Supabase via REST API |
| `scripts/ingest-projects.sh` | Batch wrapper — runs `ingest-one.cjs` for each collected file |
| `scripts/ingest-pdf.mjs` | Original CV/PDF ingestion script |

```bash
node scripts/collect-projects.mjs    # 1. Collect docs from projects
bash scripts/ingest-projects.sh      # 2. Ingest into Supabase
```

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts      # Chat endpoint (hybrid search → rerank → SSE stream)
│   │   ├── analytics/route.ts # Dashboard data
│   │   ├── evaluate/route.ts  # LLM-as-a-judge batch worker
│   │   └── feedback/route.ts  # Thumbs up/down
│   ├── analytics/             # Dashboard, login, per-trace detail
│   └── page.tsx               # Home page
├── components/
│   └── Chat.tsx               # Chat UI (sidebar + chat layout)
├── middleware.ts              # Auth for /analytics and /api/evaluate
└── lib/
    ├── embeddings.ts          # Jina embeddings client
    ├── llm.ts                 # LLM streaming & prompt construction
    ├── reranker.ts            # Jina reranker client
    ├── chunker.ts             # Text chunking with overlap
    ├── supabase.ts            # Supabase client
    ├── tracer.ts              # Per-request trace assembly → chat_traces
    ├── pricing.ts             # Cost: provider-reported, with a rate-table fallback
    ├── versions.ts            # Pipeline provenance + prompt fingerprint
    ├── judge.ts               # LLM-as-a-judge with model fallback chain
    └── no-answer.ts           # Refusal detection (EN + UK)
scripts/
├── collect-projects.mjs       # Project docs collector
├── ingest-one.cjs             # Single file ingestion
├── ingest-projects.sh         # Batch ingestion wrapper
├── ingest-pdf.mjs             # PDF ingestion
├── run-eval.cjs               # Cron wrapper for the judge
├── check-alerts.cjs           # Threshold alerts → Telegram
├── deploy.sh                  # Manual deploy to EC2
└── ec2-setup.sh               # EC2 server provisioning
supabase/migrations/           # Schema, hybrid search, traces, analytics, provenance
```

## Setup

### Prerequisites

- Node.js 18+
- Supabase project with pgvector extension
- API keys: Jina AI, OpenRouter

### Environment Variables

Required:

```
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
JINA_API_KEY=<your-jina-api-key>
OPENROUTER_API_KEY=<your-openrouter-api-key>
```

Optional — models, dashboard access and alerting:

```
GENERATOR_MODEL=deepseek/deepseek-v4-pro   # swap the generator without a deploy
JUDGE_MODEL=<slug>                         # pin one judge, or…
JUDGE_MODELS=<slug,slug,slug>              # …override the whole fallback chain
JUDGE_BATCH_SIZE=20
JUDGE_DELAY_MS=3500

ANALYTICS_PASSWORD=<dashboard-password>    # set this — there is a weak default
EVAL_CRON_KEY=<key-for-/api/evaluate>

TELEGRAM_BOT_TOKEN=<bot-token>             # omit → alerts print to stdout only
TELEGRAM_CHAT_ID=<chat-id>
ALERT_P95_MS=20000
ALERT_COST_PER_QUERY=0.002
ALERT_MIN_FAITHFULNESS=0.7
ALERT_SILENCE_HOURS=48
```

### Cron

```
*/15 * * * * cd /path/to/app && EVAL_CRON_KEY=... BASE_URL=... node scripts/run-eval.cjs
0    * * * * cd /path/to/app && node scripts/check-alerts.cjs
```

### Install & Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Deploy

Push to `master` for automatic deployment via GitHub Actions, or deploy manually:

```bash
bash scripts/deploy.sh ubuntu@<elastic-ip> ~/.ssh/your-key.pem
```

## Key Design Decisions

- **Standalone build** — `output: "standalone"` reduces deploy size from ~200MB to ~30MB
- **Direct REST API for ingestion** — Supabase JS SDK causes OOM (~2GB) for simple inserts; raw `fetch()` works reliably
- **CJS for scripts** — Node 22 + dotenv v17 ESM loader causes OOM; `.cjs` format avoids this
- **Hybrid search + RRF** — combines semantic (vector) and lexical (BM25) search for better recall
- **SSE streaming** — real-time token-by-token response delivery via Server-Sent Events
- **DuckDNS** — free dynamic DNS for the EC2 instance domain
- **Cost comes from the provider** — a local rate table drifts silently: this one carried DeepSeek V3 prices long after the same slug had been repriced, understating every cost figure by ~3x. `usage.cost` is read from the response and the table is only a fallback, with unknown models charged at the highest known rate so a gap overstates rather than hides
- **Reasoning disabled on the generator** — DeepSeek V4 is a reasoning model; left on it streams `delta.reasoning` chunks the reader drops, showing the user an empty box while still billing those tokens as completion. Grounded RAG answers do not need a reasoning pass
- **The judge is never the generator** — a model asked to score its own output grades it generously; the judge runs a separate model family, behind a fallback chain because free slugs get retired without notice
- **Provenance on every trace** — model names come from the modules that make the calls and the prompt version is a fingerprint of the prompt itself, so the recorded configuration cannot drift from the real one
- **Evaluation off the hot path** — judging runs from cron over a partial index of unjudged rows, so quality scoring never costs the user latency
