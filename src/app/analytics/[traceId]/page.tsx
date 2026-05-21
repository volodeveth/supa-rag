"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Trace {
  trace_id: string;
  query: string;
  answer: string | null;
  sources: Array<{ content: string; relevance: number; metadata: Record<string, unknown> }> | null;
  embedding_ms: number | null;
  search_ms: number | null;
  rerank_ms: number | null;
  llm_ttfb_ms: number | null;
  llm_total_ms: number | null;
  total_ms: number | null;
  chunks_found: number;
  chunks_reranked: number;
  top_relevance_score: number | null;
  avg_relevance_score: number | null;
  jina_embed_tokens: number;
  jina_rerank_tokens: number;
  llm_prompt_tokens: number;
  llm_completion_tokens: number;
  cost_usd: number | null;
  is_no_answer: boolean;
  eval_faithfulness: number | null;
  eval_answer_relevance: number | null;
  eval_context_relevance: number | null;
  eval_context_sufficiency: number | null;
  eval_judge_model: string | null;
  eval_reasoning: { reasoning?: string } | null;
  eval_at: string | null;
  status: string;
  error_message: string | null;
  error_step: string | null;
  feedback: string | null;
  feedback_comment: string | null;
  created_at: string;
  user_agent: string | null;
  ip_hash: string | null;
}

interface PipelineStep {
  name: string;
  ms: number | null;
  status: "success" | "error" | "skipped";
  details: Record<string, string | number>;
}

export default function TraceDetailPage() {
  const params = useParams();
  const traceId = params.traceId as string;
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTrace() {
      try {
        const res = await fetch(`/api/analytics?traceId=${traceId}`);
        if (res.status === 401) {
          window.location.href = `/analytics/login?redirect=/analytics/${traceId}`;
          return;
        }
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setTrace(data.trace);
        }
      } catch {
        setError("Failed to load trace");
      } finally {
        setLoading(false);
      }
    }
    fetchTrace();
  }, [traceId]);

  async function reEvaluate() {
    if (!trace) return;
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ traceIds: [trace.trace_id], delayMs: 0 }),
    });
    if (res.ok) {
      const r = await fetch(`/api/analytics?traceId=${traceId}`);
      const data = await r.json();
      if (!data.error) setTrace(data.trace);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400">Loading trace...</div>
      </div>
    );
  }

  if (error || !trace) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || "Trace not found"}</p>
          <Link href="/analytics" className="text-blue-600 hover:text-blue-800">
            &larr; Back to analytics
          </Link>
        </div>
      </div>
    );
  }

  const steps: PipelineStep[] = [
    {
      name: "Embedding",
      ms: trace.embedding_ms,
      status: trace.error_step === "embedding" ? "error" : trace.embedding_ms != null ? "success" : "skipped",
      details: { "Jina tokens": trace.jina_embed_tokens },
    },
    {
      name: "Hybrid Search",
      ms: trace.search_ms,
      status: trace.error_step === "search" ? "error" : trace.search_ms != null ? "success" : "skipped",
      details: { "Chunks found": trace.chunks_found },
    },
    {
      name: "Rerank",
      ms: trace.rerank_ms,
      status: trace.error_step === "rerank" ? "error" : trace.rerank_ms != null ? "success" : "skipped",
      details: {
        "Chunks reranked": trace.chunks_reranked,
        "Top score": trace.top_relevance_score?.toFixed(3) ?? "—",
        "Avg score": trace.avg_relevance_score?.toFixed(3) ?? "—",
        "Jina tokens": trace.jina_rerank_tokens,
      },
    },
    {
      name: "LLM Stream",
      ms: trace.llm_total_ms,
      status: trace.error_step === "llm" ? "error" : trace.llm_total_ms != null ? "success" : "skipped",
      details: {
        "TTFB": trace.llm_ttfb_ms != null ? `${trace.llm_ttfb_ms}ms` : "—",
        "Prompt tokens": trace.llm_prompt_tokens,
        "Completion tokens": trace.llm_completion_tokens,
      },
    },
  ];

  const totalMs = trace.total_ms ?? 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Trace Detail</h1>
            <p className="text-xs text-gray-400 font-mono">{trace.trace_id}</p>
          </div>
          <Link
            href="/analytics"
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            &larr; Back to analytics
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Meta */}
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <span className="text-gray-400 text-xs block">Time</span>
              <span className="font-mono">{new Date(trace.created_at).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-400 text-xs block">Status</span>
              {trace.status === "error" ? (
                <span className="text-red-600 font-medium">error</span>
              ) : trace.is_no_answer ? (
                <span className="text-amber-600 font-medium">no-answer</span>
              ) : trace.chunks_found === 0 ? (
                <span className="text-amber-600 font-medium">empty retrieval</span>
              ) : (
                <span className="text-green-600">ok</span>
              )}
            </div>
            <div>
              <span className="text-gray-400 text-xs block">Total Latency</span>
              <span className="font-mono font-bold">{totalMs}ms</span>
            </div>
            <div>
              <span className="text-gray-400 text-xs block">Cost</span>
              <span className="font-mono">
                {trace.cost_usd != null ? `$${Number(trace.cost_usd).toFixed(6)}` : "—"}
              </span>
            </div>
            <div>
              <span className="text-gray-400 text-xs block">Feedback</span>
              {trace.feedback === "thumbs_up" && <span className="text-green-600 font-medium">Thumbs up</span>}
              {trace.feedback === "thumbs_down" && <span className="text-red-600 font-medium">Thumbs down</span>}
              {!trace.feedback && <span className="text-gray-300">None</span>}
            </div>
          </div>
        </div>

        {/* LLM-as-a-judge Eval */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              LLM-as-a-judge Eval
              {trace.eval_judge_model && (
                <span className="ml-2 text-[10px] font-mono text-gray-400">
                  {trace.eval_judge_model}
                </span>
              )}
            </h2>
            <button
              onClick={reEvaluate}
              className="text-xs text-purple-600 hover:text-purple-800 cursor-pointer"
            >
              {trace.eval_at ? "Re-evaluate" : "Evaluate now"}
            </button>
          </div>
          <div className="px-5 py-4">
            {trace.eval_at ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <EvalBlock label="Faithfulness" v={trace.eval_faithfulness} />
                  <EvalBlock label="Answer Relevance" v={trace.eval_answer_relevance} />
                  <EvalBlock label="Context Relevance" v={trace.eval_context_relevance} />
                  <EvalBlock label="Context Sufficiency" v={trace.eval_context_sufficiency} />
                </div>
                {trace.eval_reasoning?.reasoning && (
                  <div className="mt-4 text-xs text-gray-600 bg-gray-50 rounded-lg p-3">
                    <span className="text-gray-400 block mb-1">Judge reasoning:</span>
                    {trace.eval_reasoning.reasoning}
                  </div>
                )}
                <div className="mt-2 text-[10px] text-gray-400">
                  Evaluated {new Date(trace.eval_at).toLocaleString()}
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-400">
                Not yet evaluated. Click &quot;Evaluate now&quot; to run the LLM-judge on this trace.
              </p>
            )}
          </div>
        </section>

        {/* Error */}
        {trace.error_message && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
            <div className="text-sm font-medium text-red-800">
              Error at step: {trace.error_step}
            </div>
            <p className="text-sm text-red-600 mt-1">{trace.error_message}</p>
          </div>
        )}

        {/* Pipeline Waterfall */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <h2 className="px-5 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">
            Pipeline Waterfall
          </h2>
          <div className="px-5 py-4 space-y-3">
            {steps.map((step) => {
              const pct = totalMs > 0 && step.ms ? Math.max((step.ms / totalMs) * 100, 2) : 0;
              const colors = {
                success: "bg-blue-500",
                error: "bg-red-500",
                skipped: "bg-gray-200",
              };

              return (
                <div key={step.name}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700">{step.name}</span>
                    <span className="text-xs font-mono text-gray-500">
                      {step.ms != null ? `${step.ms}ms` : "—"}
                    </span>
                  </div>
                  <div className="h-5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${colors[step.status]} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                    {Object.entries(step.details).map(([k, v]) => (
                      <span key={k} className="text-[10px] text-gray-400">
                        {k}: <span className="text-gray-600">{v}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Query & Answer */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <h2 className="px-5 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">
            Query & Answer
          </h2>
          <div className="px-5 py-4 space-y-4">
            <div>
              <span className="text-xs text-gray-400 block mb-1">Query</span>
              <p className="text-sm bg-blue-50 rounded-lg p-3 text-gray-900">{trace.query}</p>
            </div>
            <div>
              <span className="text-xs text-gray-400 block mb-1">Answer</span>
              <p className="text-sm bg-gray-50 rounded-lg p-3 text-gray-900 whitespace-pre-wrap">
                {trace.answer || "No answer generated"}
              </p>
            </div>
          </div>
        </section>

        {/* Sources */}
        {trace.sources && trace.sources.length > 0 && (
          <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <h2 className="px-5 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">
              Retrieved Sources ({trace.sources.length})
            </h2>
            <div className="px-5 py-4 space-y-3">
              {trace.sources.map((src, i) => (
                <div key={i} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-500">Source #{i + 1}</span>
                    <span className="text-xs font-mono text-gray-400">
                      relevance: {src.relevance.toFixed(3)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">{src.content}</p>
                  {src.metadata && Object.keys(src.metadata).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {Object.entries(src.metadata).map(([k, v]) => (
                        <span key={k} className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                          {k}: {String(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Request Meta */}
        <section className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Request Metadata</h2>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-gray-400">IP Hash</span>
              <p className="font-mono text-gray-600">{trace.ip_hash || "—"}</p>
            </div>
            <div>
              <span className="text-gray-400">User Agent</span>
              <p className="text-gray-600 truncate" title={trace.user_agent || ""}>
                {trace.user_agent || "—"}
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function EvalBlock({ label, v }: { label: string; v: number | null }) {
  const color =
    v == null
      ? "text-gray-300"
      : v < 0.5
        ? "text-red-600"
        : v < 0.75
          ? "text-amber-600"
          : "text-green-600";
  return (
    <div>
      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
        {label}
      </div>
      <div className={`text-2xl font-bold font-mono mt-0.5 ${color}`}>
        {v == null ? "—" : v.toFixed(2)}
      </div>
    </div>
  );
}
