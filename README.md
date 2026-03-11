# RAG Chat

A Retrieval-Augmented Generation chatbot built with Next.js and Supabase. Ingests PDF/text documents and answers questions using hybrid search with streaming responses.

**Live demo:** [ask-about-dorosh-rag-chat.vercel.app](https://ask-about-dorosh-rag-chat.vercel.app/)

## How It Works

1. **Document ingestion** — splits text into chunks, generates vector embeddings via Jina Embeddings v3, and stores them in Supabase (pgvector)
2. **Hybrid search** — combines vector similarity search with full-text search (BM25) using Reciprocal Rank Fusion
3. **Reranking** — Jina Reranker v3 scores and filters the top results
4. **Answer generation** — DeepSeek Chat (via OpenRouter) generates a streamed response grounded in the retrieved context

## Tech Stack

- **Frontend**: React 19, Next.js 16, Tailwind CSS v4
- **Database**: Supabase (PostgreSQL + pgvector + GIN full-text index)
- **Embeddings**: Jina Embeddings v3 (1024 dimensions)
- **Reranking**: Jina Reranker v3
- **LLM**: DeepSeek Chat via OpenRouter

## Setup

### Prerequisites

- Node.js 18+
- Supabase project with pgvector extension enabled
- API keys: Jina AI, OpenRouter

### Environment Variables

Create `.env.local`:

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

# Apply database migrations
npx supabase db push

# Ingest a document
node scripts/ingest-pdf.mjs <path-to-file>

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
src/
├── app/
│   ├── api/chat/route.ts   # Chat endpoint (search → rerank → stream)
│   └── page.tsx             # Home page
├── components/
│   └── Chat.tsx             # Chat UI
└── lib/
    ├── embeddings.ts        # Jina embeddings
    ├── llm.ts               # LLM streaming & prompt
    ├── reranker.ts          # Jina reranker
    ├── chunker.ts           # Text chunking
    └── supabase.ts          # Supabase client
scripts/
└── ingest-pdf.mjs           # Document ingestion
supabase/
└── migrations/               # Database schema & RPC functions
```
