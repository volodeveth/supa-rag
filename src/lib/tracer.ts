import { createServiceClient } from "./supabase";

interface StepTiming {
  start: number;
  end?: number;
  ms?: number;
}

interface TraceData {
  traceId: string;
  query: string;
  answer: string;
  sources: unknown[] | null;

  // Timings
  embedding: StepTiming;
  search: StepTiming;
  rerank: StepTiming;
  llm: StepTiming & { ttfbMs?: number };
  totalStart: number;

  // Metrics
  chunksFound: number;
  chunksReranked: number;
  topRelevanceScore: number;
  avgRelevanceScore: number;

  // Tokens
  jinaEmbedTokens: number;
  jinaRerankTokens: number;
  llmPromptTokens: number;
  llmCompletionTokens: number;

  // Status
  status: "success" | "error";
  errorMessage?: string;
  errorStep?: string;

  // Request metadata
  userAgent?: string;
  ipHash?: string;
}

export class PipelineTracer {
  private data: Partial<TraceData> = {};

  constructor(query?: string) {
    this.data.traceId = crypto.randomUUID();
    this.data.query = query || "";
    this.data.totalStart = performance.now();
    this.data.status = "success";
    this.data.answer = "";
    this.data.jinaEmbedTokens = 0;
    this.data.jinaRerankTokens = 0;
    this.data.llmPromptTokens = 0;
    this.data.llmCompletionTokens = 0;
  }

  get traceId(): string {
    return this.data.traceId!;
  }

  setQuery(query: string) {
    this.data.query = query;
  }

  // --- Step timing ---

  startStep(step: "embedding" | "search" | "rerank" | "llm") {
    this.data[step] = { start: performance.now() };
  }

  endStep(step: "embedding" | "search" | "rerank" | "llm") {
    const s = this.data[step];
    if (s) {
      s.end = performance.now();
      s.ms = Math.round(s.end - s.start);
    }
  }

  // LLM time-to-first-byte
  markLlmTtfb() {
    const llm = this.data.llm;
    if (llm) {
      llm.ttfbMs = Math.round(performance.now() - llm.start);
    }
  }

  // --- Metrics ---

  setSearchResults(chunksFound: number) {
    this.data.chunksFound = chunksFound;
  }

  setRerankResults(chunks: Array<{ relevance_score: number }>) {
    this.data.chunksReranked = chunks.length;
    if (chunks.length > 0) {
      this.data.topRelevanceScore = Math.max(...chunks.map((c) => c.relevance_score));
      this.data.avgRelevanceScore =
        chunks.reduce((sum, c) => sum + c.relevance_score, 0) / chunks.length;
    }
  }

  setSources(sources: unknown[]) {
    this.data.sources = sources;
  }

  appendAnswer(token: string) {
    this.data.answer = (this.data.answer || "") + token;
  }

  // --- Tokens ---

  addJinaEmbedTokens(tokens: number) {
    this.data.jinaEmbedTokens = (this.data.jinaEmbedTokens || 0) + tokens;
  }

  addJinaRerankTokens(tokens: number) {
    this.data.jinaRerankTokens = (this.data.jinaRerankTokens || 0) + tokens;
  }

  setLlmTokens(prompt: number, completion: number) {
    this.data.llmPromptTokens = prompt;
    this.data.llmCompletionTokens = completion;
  }

  // --- Error ---

  setError(step: string, message: string) {
    this.data.status = "error";
    this.data.errorStep = step;
    this.data.errorMessage = message;
  }

  // --- Request metadata ---

  setRequestMeta(userAgent?: string, ipHash?: string) {
    this.data.userAgent = userAgent;
    this.data.ipHash = ipHash;
  }

  // --- Save to Supabase ---

  async save(): Promise<void> {
    const totalMs = Math.round(performance.now() - this.data.totalStart!);

    const row = {
      trace_id: this.data.traceId,
      query: this.data.query,
      answer: this.data.answer || null,
      sources: this.data.sources || null,
      embedding_ms: this.data.embedding?.ms ?? null,
      search_ms: this.data.search?.ms ?? null,
      rerank_ms: this.data.rerank?.ms ?? null,
      llm_ttfb_ms: this.data.llm?.ttfbMs ?? null,
      llm_total_ms: this.data.llm?.ms ?? null,
      total_ms: totalMs,
      chunks_found: this.data.chunksFound ?? 0,
      chunks_reranked: this.data.chunksReranked ?? 0,
      top_relevance_score: this.data.topRelevanceScore ?? null,
      avg_relevance_score: this.data.avgRelevanceScore ?? null,
      jina_embed_tokens: this.data.jinaEmbedTokens ?? 0,
      jina_rerank_tokens: this.data.jinaRerankTokens ?? 0,
      llm_prompt_tokens: this.data.llmPromptTokens ?? 0,
      llm_completion_tokens: this.data.llmCompletionTokens ?? 0,
      status: this.data.status,
      error_message: this.data.errorMessage ?? null,
      error_step: this.data.errorStep ?? null,
      user_agent: this.data.userAgent ?? null,
      ip_hash: this.data.ipHash ?? null,
    };

    try {
      const supabase = createServiceClient();
      const { error } = await supabase.from("chat_traces").insert(row);
      if (error) {
        console.error("Failed to save trace:", error);
      }
    } catch (err) {
      console.error("Trace save error:", err);
    }
  }
}

// Hash IP for privacy (no raw IPs stored)
export async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + "rag-chat-salt");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
