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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-400 text-xs block">Time</span>
              <span className="font-mono">{new Date(trace.created_at).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-400 text-xs block">Status</span>
              <span className={trace.status === "error" ? "text-red-600 font-medium" : "text-green-600"}>
                {trace.status}
              </span>
            </div>
            <div>
              <span className="text-gray-400 text-xs block">Total Latency</span>
              <span className="font-mono font-bold">{totalMs}ms</span>
            </div>
            <div>
              <span className="text-gray-400 text-xs block">Feedback</span>
              {trace.feedback === "thumbs_up" && <span className="text-green-600 font-medium">Thumbs up</span>}
              {trace.feedback === "thumbs_down" && <span className="text-red-600 font-medium">Thumbs down</span>}
              {!trace.feedback && <span className="text-gray-300">None</span>}
            </div>
          </div>
        </div>

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
