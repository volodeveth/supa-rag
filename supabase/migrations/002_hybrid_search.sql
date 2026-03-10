-- 1. Generated tsvector column (auto-maintained on INSERT/UPDATE)
ALTER TABLE documents
  ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- 2. GIN index for fast full-text search
CREATE INDEX documents_fts_idx ON documents USING gin(fts);

-- 3. Hybrid search function with Reciprocal Rank Fusion (RRF)
CREATE OR REPLACE FUNCTION hybrid_search(
  query_text       text,
  query_embedding  extensions.vector(1024),
  match_count      int   DEFAULT 20,
  rrf_k            int   DEFAULT 60,
  fts_weight       float DEFAULT 0.5,
  vec_weight       float DEFAULT 0.5
)
RETURNS TABLE (
  id         bigint,
  content    text,
  metadata   jsonb,
  rrf_score  float
)
LANGUAGE sql
AS $$
  WITH
  fts AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(fts, plainto_tsquery('english', query_text)) DESC) AS rank
    FROM documents
    WHERE fts @@ plainto_tsquery('english', query_text)
    LIMIT 60
  ),
  vec AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> query_embedding) AS rank
    FROM documents
    ORDER BY embedding <=> query_embedding
    LIMIT 60
  ),
  rrf AS (
    SELECT
      COALESCE(fts.id, vec.id) AS id,
      COALESCE(fts_weight / (rrf_k + fts.rank), 0.0) +
      COALESCE(vec_weight / (rrf_k + vec.rank), 0.0) AS score
    FROM fts FULL OUTER JOIN vec ON fts.id = vec.id
  )
  SELECT d.id, d.content, d.metadata, rrf.score AS rrf_score
  FROM rrf JOIN documents d ON d.id = rrf.id
  ORDER BY rrf.score DESC
  LIMIT match_count;
$$;
