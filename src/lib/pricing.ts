// Token → USD pricing. Update when providers change rates.
// Sources (verify periodically):
//   - jina.ai/embeddings  → jina-embeddings-v3
//   - jina.ai/reranker    → jina-reranker-v3
//   - openrouter.ai/models/deepseek/deepseek-chat
//
// All prices are USD per token (NOT per 1M tokens).

const PRICE_PER_TOKEN = {
  jina_embed: 0.018 / 1_000_000,        // $0.018 / 1M
  jina_rerank: 0.018 / 1_000_000,       // $0.018 / 1M
  llm_prompt: 0.14 / 1_000_000,         // DeepSeek V3 input
  llm_completion: 0.28 / 1_000_000,     // DeepSeek V3 output
} as const;

interface TokenCounts {
  jinaEmbedTokens?: number | null;
  jinaRerankTokens?: number | null;
  llmPromptTokens?: number | null;
  llmCompletionTokens?: number | null;
}

export function computeCostUsd(t: TokenCounts): number {
  const embed = (t.jinaEmbedTokens ?? 0) * PRICE_PER_TOKEN.jina_embed;
  const rerank = (t.jinaRerankTokens ?? 0) * PRICE_PER_TOKEN.jina_rerank;
  const prompt = (t.llmPromptTokens ?? 0) * PRICE_PER_TOKEN.llm_prompt;
  const completion = (t.llmCompletionTokens ?? 0) * PRICE_PER_TOKEN.llm_completion;
  return embed + rerank + prompt + completion;
}
