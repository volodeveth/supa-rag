-- Chat traces table for monitoring, observability, and evaluation
create table if not exists chat_traces (
  id bigint generated always as identity primary key,
  trace_id uuid not null default gen_random_uuid(),
  query text not null,
  answer text,
  sources jsonb,

  -- Pipeline latencies (ms)
  embedding_ms integer,
  search_ms integer,
  rerank_ms integer,
  llm_ttfb_ms integer,
  llm_total_ms integer,
  total_ms integer,

  -- Pipeline metrics
  chunks_found integer default 0,
  chunks_reranked integer default 0,
  top_relevance_score real,
  avg_relevance_score real,

  -- Token usage
  jina_embed_tokens integer default 0,
  jina_rerank_tokens integer default 0,
  llm_prompt_tokens integer default 0,
  llm_completion_tokens integer default 0,

  -- Status
  status text not null default 'success' check (status in ('success', 'error')),
  error_message text,
  error_step text,

  -- Evaluation
  feedback text check (feedback in ('thumbs_up', 'thumbs_down')),
  feedback_comment text,

  -- Metadata
  created_at timestamptz not null default now(),
  user_agent text,
  ip_hash text
);

-- Indexes
create unique index idx_chat_traces_trace_id on chat_traces (trace_id);
create index idx_chat_traces_created_at on chat_traces (created_at desc);
create index idx_chat_traces_feedback on chat_traces (feedback) where feedback is not null;
create index idx_chat_traces_status on chat_traces (status);

-- Analytics view: daily aggregates
create or replace view chat_analytics_daily as
select
  date_trunc('day', created_at)::date as day,
  count(*) as total_queries,
  count(*) filter (where status = 'error') as errors,
  count(*) filter (where feedback = 'thumbs_up') as thumbs_up,
  count(*) filter (where feedback = 'thumbs_down') as thumbs_down,
  round(avg(total_ms)) as avg_total_ms,
  round(avg(embedding_ms)) as avg_embedding_ms,
  round(avg(search_ms)) as avg_search_ms,
  round(avg(rerank_ms)) as avg_rerank_ms,
  round(avg(llm_total_ms)) as avg_llm_ms,
  round(avg(top_relevance_score)::numeric, 3) as avg_top_relevance,
  round(avg(chunks_found)::numeric, 1) as avg_chunks_found,
  sum(jina_embed_tokens + jina_rerank_tokens) as total_jina_tokens,
  sum(llm_prompt_tokens + llm_completion_tokens) as total_llm_tokens
from chat_traces
group by date_trunc('day', created_at)::date
order by day desc;
