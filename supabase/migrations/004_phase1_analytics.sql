-- Phase 1 monitoring: cheap metrics + LLM-judge eval columns
-- Adds:
--   * is_no_answer  — model returned a stock "I don't know" answer
--   * cost_usd      — per-query USD cost (jina embed + jina rerank + LLM)
--   * eval_*        — LLM-as-a-judge scores (async, populated by /api/evaluate)
--   * extended chat_analytics_daily view (p50/p95/p99, cost, eval averages)
--   * chat_relevance_histogram view (top_relevance_score buckets)

alter table chat_traces
  add column if not exists is_no_answer boolean not null default false,
  add column if not exists cost_usd numeric(10, 8),
  add column if not exists eval_faithfulness real,
  add column if not exists eval_answer_relevance real,
  add column if not exists eval_context_relevance real,
  add column if not exists eval_context_sufficiency real,
  add column if not exists eval_judge_model text,
  add column if not exists eval_reasoning jsonb,
  add column if not exists eval_at timestamptz;

-- Index: feed for the LLM-judge worker
-- Picks up traces that are eligible but not yet evaluated.
create index if not exists idx_chat_traces_eval_pending
  on chat_traces (created_at desc)
  where eval_at is null and status = 'success' and answer is not null;

-- Index: low-faithfulness/relevance scan
create index if not exists idx_chat_traces_eval_low
  on chat_traces (eval_faithfulness)
  where eval_faithfulness is not null;

-- ---------------------------------------------------------------------------
-- View: chat_analytics_daily (replace with extended version)
-- ---------------------------------------------------------------------------
drop view if exists chat_analytics_daily;

create or replace view chat_analytics_daily as
select
  date_trunc('day', created_at)::date as day,
  count(*) as total_queries,
  count(*) filter (where status = 'error') as errors,
  count(*) filter (where is_no_answer) as no_answers,
  count(*) filter (where chunks_found = 0) as empty_retrievals,
  count(*) filter (where feedback = 'thumbs_up') as thumbs_up,
  count(*) filter (where feedback = 'thumbs_down') as thumbs_down,

  -- Latency averages
  round(avg(total_ms)) as avg_total_ms,
  round(avg(embedding_ms)) as avg_embedding_ms,
  round(avg(search_ms)) as avg_search_ms,
  round(avg(rerank_ms)) as avg_rerank_ms,
  round(avg(llm_total_ms)) as avg_llm_ms,
  round(avg(llm_ttfb_ms)) as avg_llm_ttfb_ms,

  -- Latency percentiles
  round(percentile_cont(0.5) within group (order by total_ms))::int as p50_total_ms,
  round(percentile_cont(0.95) within group (order by total_ms))::int as p95_total_ms,
  round(percentile_cont(0.99) within group (order by total_ms))::int as p99_total_ms,

  -- Retrieval signal
  round(avg(top_relevance_score)::numeric, 3) as avg_top_relevance,
  round(avg(chunks_found)::numeric, 1) as avg_chunks_found,

  -- Tokens
  sum(jina_embed_tokens + jina_rerank_tokens) as total_jina_tokens,
  sum(llm_prompt_tokens + llm_completion_tokens) as total_llm_tokens,

  -- Cost
  round(sum(cost_usd)::numeric, 6) as total_cost_usd,
  round(avg(cost_usd)::numeric, 8) as avg_cost_usd,

  -- LLM-judge evals (nulls excluded by avg automatically)
  round(avg(eval_faithfulness)::numeric, 3) as avg_faithfulness,
  round(avg(eval_answer_relevance)::numeric, 3) as avg_answer_relevance,
  round(avg(eval_context_relevance)::numeric, 3) as avg_context_relevance,
  round(avg(eval_context_sufficiency)::numeric, 3) as avg_context_sufficiency,
  count(*) filter (where eval_at is not null) as evaluated_count
from chat_traces
group by date_trunc('day', created_at)::date
order by day desc;

-- ---------------------------------------------------------------------------
-- View: chat_relevance_histogram
-- Bucketed distribution of top_relevance_score for last 30 days.
-- ---------------------------------------------------------------------------
create or replace view chat_relevance_histogram as
with buckets as (
  select
    case
      when top_relevance_score is null then 'null'
      when top_relevance_score < 0.2 then '0.0-0.2'
      when top_relevance_score < 0.4 then '0.2-0.4'
      when top_relevance_score < 0.6 then '0.4-0.6'
      when top_relevance_score < 0.8 then '0.6-0.8'
      else '0.8-1.0'
    end as bucket
  from chat_traces
  where created_at >= now() - interval '30 days'
)
select bucket, count(*)::int as count
from buckets
group by bucket
order by bucket;
