# Ask About Dorosh — RAG Chat

> **Live:** [ask-about-dorosh.duckdns.org](https://ask-about-dorosh.duckdns.org/)

Production-grade Retrieval-Augmented Generation chatbot. Ingests PDF/text documents, indexes source code from 16 projects, and answers questions using hybrid vector + full-text search with real-time SSE streaming.

## How It Works

```
PDF/Text → Chunk → Jina Embed (1024d) → Supabase pgvector
                                              ↓
User query → Embed → Hybrid Search (vector + BM25) → RRF Fusion → Jina Rerank → DeepSeek LLM → SSE Stream
```

1. **Document ingestion** — splits text into overlapping chunks, generates 1024-dimensional vector embeddings via Jina Embeddings v3, stores in Supabase (PostgreSQL + pgvector)
2. **Hybrid search** — combines vector similarity search with full-text search (GIN index, BM25) using Reciprocal Rank Fusion (RRF)
3. **Reranking** — Jina Reranker v3 scores and filters the top results for relevance
4. **Answer generation** — DeepSeek Chat (via OpenRouter) generates a streamed response grounded in the retrieved context

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS v4 |
| **Database** | Supabase (PostgreSQL + pgvector + GIN full-text index) |
| **Embeddings** | Jina Embeddings v3 (1024 dimensions) |
| **Reranking** | Jina Reranker v3 |
| **LLM** | DeepSeek Chat via OpenRouter |
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

## Data Pipeline

| Script | Purpose |
|--------|---------|
| `scripts/collect-projects.mjs` | Scans 16 project directories, extracts README/package.json/docs |
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
│   ├── api/chat/route.ts     # Chat endpoint (hybrid search → rerank → SSE stream)
│   └── page.tsx               # Home page
├── components/
│   └── Chat.tsx               # Chat UI (sidebar + chat layout)
└── lib/
    ├── embeddings.ts          # Jina embeddings client
    ├── llm.ts                 # LLM streaming & prompt construction
    ├── reranker.ts            # Jina reranker client
    ├── chunker.ts             # Text chunking with overlap
    └── supabase.ts            # Supabase client
scripts/
├── collect-projects.mjs       # Project docs collector
├── ingest-one.cjs             # Single file ingestion
├── ingest-projects.sh         # Batch ingestion wrapper
├── ingest-pdf.mjs             # PDF ingestion
├── deploy.sh                  # Manual deploy to EC2
└── ec2-setup.sh               # EC2 server provisioning
```

## Setup

### Prerequisites

- Node.js 18+
- Supabase project with pgvector extension
- API keys: Jina AI, OpenRouter

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
JINA_API_KEY=<your-jina-api-key>
OPENROUTER_API_KEY=<your-openrouter-api-key>
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
