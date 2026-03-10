interface JinaRerankResult {
  index: number;
  relevance_score: number;
}

interface JinaRerankResponse {
  results: JinaRerankResult[];
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

interface Chunk {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  rrf_score: number;
}

interface RankedChunk {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  relevance_score: number;
}

export async function rerankChunks(
  query: string,
  chunks: Chunk[],
  topN: number = 5
): Promise<RankedChunk[]> {
  if (chunks.length === 0) return [];
  if (chunks.length <= topN) {
    return chunks.map((c) => ({
      id: c.id,
      content: c.content,
      metadata: c.metadata,
      relevance_score: c.rrf_score,
    }));
  }

  const response = await fetch("https://api.jina.ai/v1/rerank", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.JINA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: "jina-reranker-v3",
      query,
      documents: chunks.map((c) => c.content),
      top_n: topN,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Jina Reranker error: ${err.detail ?? response.statusText}`);
  }

  const json: JinaRerankResponse = await response.json();

  return json.results.map((r) => ({
    id: chunks[r.index].id,
    content: chunks[r.index].content,
    metadata: chunks[r.index].metadata,
    relevance_score: r.relevance_score,
  }));
}
