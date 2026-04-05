interface JinaEmbeddingResponse {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

type EmbeddingTask = "retrieval.passage" | "retrieval.query";

interface EmbeddingResult {
  embeddings: number[][];
  totalTokens: number;
}

export async function generateEmbeddings(
  texts: string[],
  task: EmbeddingTask = "retrieval.passage"
): Promise<EmbeddingResult> {
  const response = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.JINA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: "jina-embeddings-v3",
      input: texts,
      task,
      dimensions: 1024,
      normalized: true,
      embedding_type: "float",
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Jina API error: ${err.detail ?? response.statusText}`);
  }

  const json: JinaEmbeddingResponse = await response.json();
  return {
    embeddings: json.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding),
    totalTokens: json.usage?.total_tokens ?? 0,
  };
}

interface QueryEmbeddingResult {
  embedding: number[];
  totalTokens: number;
}

export async function generateQueryEmbedding(
  query: string
): Promise<QueryEmbeddingResult> {
  const { embeddings, totalTokens } = await generateEmbeddings([query], "retrieval.query");
  return { embedding: embeddings[0], totalTokens };
}
