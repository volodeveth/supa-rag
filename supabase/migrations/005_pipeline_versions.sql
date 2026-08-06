-- Pipeline provenance: what produced this trace.
-- Without these, a change in quality metrics cannot be attributed to a change
-- we made — we can see that faithfulness dropped, but not whether the prompt,
-- the generator, the embedder or the reranker moved under us.
--
-- prompt_version is a content fingerprint of the system prompt, computed at
-- runtime, so it can never drift out of sync with the prompt itself.

alter table chat_traces
  add column if not exists generator_model text,
  add column if not exists embedding_model text,
  add column if not exists reranker_model text,
  add column if not exists prompt_version text;

-- Compare runs of one configuration over time (the A/B access pattern).
create index if not exists idx_chat_traces_config
  on chat_traces (generator_model, prompt_version, created_at desc);

-- ---------------------------------------------------------------------------
-- View: chat_analytics_by_config
-- Same quality/cost/latency columns as the daily view, grouped by the pipeline
-- configuration instead of by day. This is the A/B table: one row per config.
-- ---------------------------------------------------------------------------
create or replace view chat_analytics_by_config as
select
  coalesce(generator_model, 'unknown') as generator_model,
  coalesce(prompt_version, 'unknown') as prompt_version,
  coalesce(embedding_model, 'unknown') as embedding_model,
  coalesce(reranker_model, 'unknown') as reranker_model,
  count(*) as total_queries,
  min(created_at) as first_seen,
  max(created_at) as last_seen,
  count(*) filter (where status = 'error') as errors,
  count(*) filter (where is_no_answer) as no_answers,
  round(percentile_cont(0.5) within group (order by total_ms))::int as p50_total_ms,
  round(percentile_cont(0.95) within group (order by total_ms))::int as p95_total_ms,
  round(avg(top_relevance_score)::numeric, 3) as avg_top_relevance,
  round(avg(cost_usd)::numeric, 8) as avg_cost_usd,
  round(avg(eval_faithfulness)::numeric, 3) as avg_faithfulness,
  round(avg(eval_answer_relevance)::numeric, 3) as avg_answer_relevance,
  round(avg(eval_context_relevance)::numeric, 3) as avg_context_relevance,
  round(avg(eval_context_sufficiency)::numeric, 3) as avg_context_sufficiency,
  count(*) filter (where eval_at is not null) as evaluated_count
from chat_traces
group by 1, 2, 3, 4
order by last_seen desc;
