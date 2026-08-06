// Token → USD pricing.
//
// The rate table below is a FALLBACK. It exists only for the case where a
// provider does not report what a call cost. Hardcoded rates drift silently:
// this table claimed DeepSeek V3 rates of $0.14/$0.28 per 1M long after
// OpenRouter had repriced the same slug to $0.257/$1.029, which understated
// every cost figure on the dashboard by roughly 3x. Prefer the number the
// provider itself returns (`usage.cost`) whenever there is one.
//
// Sources (verify periodically):
//   - jina.ai/embeddings  → jina-embeddings-v3
//   - jina.ai/reranker    → jina-reranker-v3
//   - openrouter.ai/models/<slug>
//
// All prices are USD per 1M tokens; conversion happens in rate().

const JINA_PER_M = {
  embed: 0.018,
  rerank: 0.018,
} as const;

// Checked 2026-08-06 against openrouter.ai/api/v1/models.
const LLM_PER_M: Record<string, { prompt: number; completion: number }> = {
  "deepseek/deepseek-v4-pro": { prompt: 0.435, completion: 0.87 },
  "deepseek/deepseek-v4-flash": { prompt: 0.088, completion: 0.176 },
  "deepseek/deepseek-v4-flash-0731": { prompt: 0.09, completion: 0.18 },
  "deepseek/deepseek-v3.2": { prompt: 0.269, completion: 0.4 },
  "deepseek/deepseek-chat": { prompt: 0.257, completion: 1.029 },
};

// Used when the model is unknown to the table — deliberately the most
// expensive entry, so an unpriced model overstates rather than hides cost.
const UNKNOWN_MODEL_RATE = { prompt: 0.435, completion: 0.87 };

interface TokenCounts {
  jinaEmbedTokens?: number | null;
  jinaRerankTokens?: number | null;
  llmPromptTokens?: number | null;
  llmCompletionTokens?: number | null;
  /** Model that served the completion — selects the fallback rate. */
  llmModel?: string | null;
  /** Cost the provider reported for the completion, if it reported one. */
  llmCostUsd?: number | null;
}

const perToken = (perMillion: number) => perMillion / 1_000_000;

/** Cost of the retrieval stages, which no provider reports for us. */
function retrievalCost(t: TokenCounts): number {
  return (
    (t.jinaEmbedTokens ?? 0) * perToken(JINA_PER_M.embed) +
    (t.jinaRerankTokens ?? 0) * perToken(JINA_PER_M.rerank)
  );
}

/** Estimated completion cost from the local rate table. */
function estimatedLlmCost(t: TokenCounts): number {
  const rate =
    (t.llmModel ? LLM_PER_M[t.llmModel] : undefined) ?? UNKNOWN_MODEL_RATE;
  return (
    (t.llmPromptTokens ?? 0) * perToken(rate.prompt) +
    (t.llmCompletionTokens ?? 0) * perToken(rate.completion)
  );
}

export function computeCostUsd(t: TokenCounts): number {
  const llm =
    typeof t.llmCostUsd === "number" && t.llmCostUsd >= 0
      ? t.llmCostUsd
      : estimatedLlmCost(t);
  return retrievalCost(t) + llm;
}

/** True when the LLM half of the cost came from the provider, not the table. */
export function isReportedCost(t: TokenCounts): boolean {
  return typeof t.llmCostUsd === "number" && t.llmCostUsd >= 0;
}
