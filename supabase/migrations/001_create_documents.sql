-- Enable pgvector extension
create extension if not exists vector with schema extensions;

-- Documents table with 1024-dim embeddings (Jina v3)
create table documents (
  id bigserial primary key,
  content text not null,
  metadata jsonb default '{}',
  embedding extensions.vector(1024) not null
);

-- Row level security
alter table documents enable row level security;

-- Allow anonymous read access for search
create policy "Allow anonymous read" on documents
  for select using (true);

-- HNSW index for fast cosine similarity search
create index on documents
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Search function
create or replace function match_documents(
  query_embedding extensions.vector(1024),
  match_threshold float default 0.7,
  match_count int default 5
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where 1 - (documents.embedding <=> query_embedding) > match_threshold
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;
