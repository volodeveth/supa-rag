"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Summary {
  totalQueries: number;
  errors: number;
  errorRate: number;
  noAnswers: number;
  noAnswerRate: number;
  emptyRetrievals: number;
  emptyRetrievalRate: number;
  thumbsUp: number;
  thumbsDown: number;
  feedbackRate: number;
  satisfactionRate: number;
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  avgRelevance: number;
  totalCostUsd: number;
  avgCostUsd: number;
  eval: {
    evaluatedCount: number;
    evaluatedRate: number;
    avgFaithfulness: number | null;
    avgAnswerRelevance: number | null;
    avgContextRelevance: number | null;
    avgContextSufficiency: number | null;
  };
  days: number;
}

interface DailyRow {
  day: string;
  total_queries: number;
  errors: number;
  no_answers: number;
  empty_retrievals: number;
  thumbs_up: number;
  thumbs_down: number;
  avg_total_ms: number;
  avg_embedding_ms: number;
  avg_search_ms: number;
  avg_rerank_ms: number;
  avg_llm_ms: number;
  p50_total_ms: number;
  p95_total_ms: number;
  p99_total_ms: number;
  avg_top_relevance: number;
  avg_chunks_found: number;
  total_jina_tokens: number;
  total_llm_tokens: number;
  total_cost_usd: number;
  avg_faithfulness: number | null;
  avg_answer_relevance: number | null;
  avg_context_relevance: number | null;
  avg_context_sufficiency: number | null;
  evaluated_count: number;
}

interface HistogramRow {
  bucket: string;
  count: number;
}

interface TraceRow {
  trace_id: string;
  query: string;
  status: string;
  feedback: string | null;
  total_ms: number;
  top_relevance_score: number | null;
  chunks_found: number;
  created_at: string;
  error_step: string | null;
  is_no_answer: boolean;
  cost_usd: number | null;
  eval_faithfulness: number | null;
  eval_answer_relevance: number | null;
  eval_at: string | null;
}

type FeedbackFilter = "all" | "thumbs_up" | "thumbs_down" | "none";
type StatusFilter = "all" | "success" | "error";
type CategoryFilter = "all" | "problematic" | "no_answer" | "empty_retrieval" | "low_faithfulness";

const BUCKET_ORDER = ["null", "0.0-0.2", "0.2-0.4", "0.4-0.6", "0.6-0.8", "0.8-1.0"];

export default function AnalyticsDashboard() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [histogram, setHistogram] = useState<HistogramRow[]>([]);
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [days, setDays] = useState(30);
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalResult, setEvalResult] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      days: days.toString(),
      page: page.toString(),
      limit: "50",
    });
    if (feedbackFilter !== "all") params.set("feedback", feedbackFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (categoryFilter !== "all") params.set("category", categoryFilter);

    try {
      const res = await fetch(`/api/analytics?${params}`);
      if (res.status === 401) {
        router.replace("/analytics/login");
        return;
      }
      const data = await res.json();
      setSummary(data.summary);
      setDaily(data.daily || []);
      setHistogram(data.histogram || []);
      setTraces(data.traces || []);
    } catch {
      console.error("Failed to fetch analytics");
    } finally {
      setLoading(false);
    }
  }, [days, feedbackFilter, statusFilter, categoryFilter, page, router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function runEval() {
    setEvalRunning(true);
    setEvalResult(null);
    try {
      const res = await fetch("/api/evaluate", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setEvalResult(
          `Evaluated ${data.evaluated} / ${data.total} (failed ${data.failed})`
        );
        fetchData();
      } else {
        setEvalResult(`Error: ${data.error || "unknown"}`);
      }
    } catch {
      setEvalResult("Network error");
    } finally {
      setEvalRunning(false);
    }
  }

  async function logout() {
    await fetch("/api/analytics/login", { method: "DELETE" });
    router.replace("/analytics/login");
  }

  // Order + fill histogram buckets
  const histMap = new Map(histogram.map((h) => [h.bucket, h.count]));
  const histOrdered = BUCKET_ORDER.filter((b) => b !== "null" || (histMap.get(b) ?? 0) > 0).map(
    (bucket) => ({ bucket, count: histMap.get(bucket) ?? 0 })
  );
  const histMax = Math.max(1, ...histOrdered.map((r) => r.count));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">RAG Analytics</h1>
            <p className="text-sm text-gray-500">Monitoring, evaluation & observability</p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
            >
              &larr; Back to chat
            </Link>
            <button
              onClick={logout}
              className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-center">
          <select
            value={days}
            onChange={(e) => { setDays(Number(e.target.value)); setPage(1); }}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value as CategoryFilter); setPage(1); }}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="all">All categories</option>
            <option value="problematic">Problematic (any)</option>
            <option value="no_answer">No answer</option>
            <option value="empty_retrieval">Empty retrieval</option>
            <option value="low_faithfulness">Low faithfulness (&lt; 0.5)</option>
          </select>

          <select
            value={feedbackFilter}
            onChange={(e) => { setFeedbackFilter(e.target.value as FeedbackFilter); setPage(1); }}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="all">All feedback</option>
            <option value="thumbs_up">Thumbs up only</option>
            <option value="thumbs_down">Thumbs down only</option>
            <option value="none">No feedback</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="all">All status</option>
            <option value="success">Success</option>
            <option value="error">Errors</option>
          </select>

          <button
            onClick={fetchData}
            className="text-sm bg-blue-600 text-white rounded-lg px-4 py-1.5 hover:bg-blue-700 transition-colors cursor-pointer"
          >
            Refresh
          </button>

          <button
            onClick={runEval}
            disabled={evalRunning}
            className="text-sm bg-purple-600 text-white rounded-lg px-4 py-1.5 hover:bg-purple-700 transition-colors cursor-pointer disabled:opacity-50"
            title="Run LLM-as-a-judge eval batch on unevaluated traces"
          >
            {evalRunning ? "Running eval..." : "Run eval batch"}
          </button>

          {evalResult && (
            <span className="text-xs text-gray-500">{evalResult}</span>
          )}
        </div>

        {loading && !summary ? (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        ) : (
          <>
            {/* Operational Cards */}
            {summary && (
              <>
                <section>
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Volume & Outcomes
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    <StatCard label="Total Queries" value={summary.totalQueries} />
                    <StatCard
                      label="Error Rate"
                      value={`${summary.errorRate}%`}
                      sub={`${summary.errors} errors`}
                      alert={summary.errorRate > 5}
                    />
                    <StatCard
                      label="No-Answer Rate"
                      value={`${summary.noAnswerRate}%`}
                      sub={`${summary.noAnswers} refusals`}
                      alert={summary.noAnswerRate > 25}
                    />
                    <StatCard
                      label="Empty Retrieval"
                      value={`${summary.emptyRetrievalRate}%`}
                      sub={`${summary.emptyRetrievals} queries`}
                      alert={summary.emptyRetrievalRate > 10}
                    />
                    <StatCard label="Satisfaction" value={`${summary.satisfactionRate}%`} />
                    <StatCard
                      label="Feedback"
                      value={`${summary.thumbsUp} / ${summary.thumbsDown}`}
                      sub="up / down"
                    />
                  </div>
                </section>

                <section>
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Latency & Cost
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    <StatCard label="Avg Latency" value={`${summary.avgLatency}ms`} />
                    <StatCard label="p50" value={`${summary.p50Latency}ms`} />
                    <StatCard label="p95" value={`${summary.p95Latency}ms`} />
                    <StatCard
                      label="p99"
                      value={`${summary.p99Latency}ms`}
                      alert={summary.p99Latency > 15000}
                    />
                    <StatCard
                      label="Cost (total)"
                      value={`$${summary.totalCostUsd.toFixed(4)}`}
                      sub={`${summary.days}d`}
                    />
                    <StatCard
                      label="Cost / Query"
                      value={`$${summary.avgCostUsd.toFixed(6)}`}
                    />
                  </div>
                </section>

                <section>
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Quality (LLM-as-a-judge) — {summary.eval.evaluatedCount} / {summary.totalQueries} evaluated
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    <ScoreCard
                      label="Faithfulness"
                      value={summary.eval.avgFaithfulness}
                      hint="Answer grounded in context"
                    />
                    <ScoreCard
                      label="Answer Relevance"
                      value={summary.eval.avgAnswerRelevance}
                      hint="Addresses the question"
                    />
                    <ScoreCard
                      label="Context Relevance"
                      value={summary.eval.avgContextRelevance}
                      hint="Chunks on-topic"
                    />
                    <ScoreCard
                      label="Context Sufficiency"
                      value={summary.eval.avgContextSufficiency}
                      hint="Enough info to answer (recall-proxy)"
                    />
                    <StatCard
                      label="Avg Top Relevance"
                      value={summary.avgRelevance.toFixed(3)}
                      sub="Reranker score"
                    />
                  </div>
                </section>
              </>
            )}

            {/* Relevance Histogram */}
            {histOrdered.length > 0 && (
              <section className="bg-white rounded-xl border border-gray-200 px-5 py-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">
                  Top Relevance Histogram (last 30d)
                </h2>
                <div className="space-y-1.5">
                  {histOrdered.map((row) => (
                    <div key={row.bucket} className="flex items-center gap-3">
                      <span className="text-xs font-mono text-gray-500 w-16">
                        {row.bucket}
                      </span>
                      <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${(row.count / histMax) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-gray-600 w-12 text-right">
                        {row.count}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Daily Breakdown */}
            {daily.length > 0 && (
              <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <h2 className="px-4 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">
                  Daily Breakdown
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-left">
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Queries</th>
                        <th className="px-3 py-2 font-medium">Err</th>
                        <th className="px-3 py-2 font-medium">No-Ans</th>
                        <th className="px-3 py-2 font-medium">p50</th>
                        <th className="px-3 py-2 font-medium">p95</th>
                        <th className="px-3 py-2 font-medium">p99</th>
                        <th className="px-3 py-2 font-medium">Rel</th>
                        <th className="px-3 py-2 font-medium">Cost</th>
                        <th className="px-3 py-2 font-medium">Faith</th>
                        <th className="px-3 py-2 font-medium">A.Rel</th>
                        <th className="px-3 py-2 font-medium">C.Rel</th>
                        <th className="px-3 py-2 font-medium">C.Suf</th>
                        <th className="px-3 py-2 font-medium">FB</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map((row) => (
                        <tr key={row.day} className="border-t border-gray-50 hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono">{row.day}</td>
                          <td className="px-3 py-2">{row.total_queries}</td>
                          <td className="px-3 py-2">
                            <span className={row.errors > 0 ? "text-red-600 font-medium" : ""}>
                              {row.errors}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={row.no_answers > 0 ? "text-amber-600" : ""}>
                              {row.no_answers}
                            </span>
                          </td>
                          <td className="px-3 py-2">{row.p50_total_ms}ms</td>
                          <td className="px-3 py-2">{row.p95_total_ms}ms</td>
                          <td className="px-3 py-2">{row.p99_total_ms}ms</td>
                          <td className="px-3 py-2">{row.avg_top_relevance ?? "—"}</td>
                          <td className="px-3 py-2">
                            ${Number(row.total_cost_usd ?? 0).toFixed(4)}
                          </td>
                          <td className="px-3 py-2"><ScoreCell v={row.avg_faithfulness} /></td>
                          <td className="px-3 py-2"><ScoreCell v={row.avg_answer_relevance} /></td>
                          <td className="px-3 py-2"><ScoreCell v={row.avg_context_relevance} /></td>
                          <td className="px-3 py-2"><ScoreCell v={row.avg_context_sufficiency} /></td>
                          <td className="px-3 py-2">
                            <span className="text-green-600">{row.thumbs_up}</span>
                            {" / "}
                            <span className="text-red-600">{row.thumbs_down}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Traces */}
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <h2 className="px-4 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">
                Recent Traces
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Query</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Latency</th>
                      <th className="px-3 py-2 font-medium">Rel</th>
                      <th className="px-3 py-2 font-medium">Chunks</th>
                      <th className="px-3 py-2 font-medium">Cost</th>
                      <th className="px-3 py-2 font-medium">Faith</th>
                      <th className="px-3 py-2 font-medium">A.Rel</th>
                      <th className="px-3 py-2 font-medium">FB</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {traces.map((t) => (
                      <tr key={t.trace_id} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-gray-400 whitespace-nowrap">
                          {new Date(t.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 max-w-xs truncate" title={t.query}>
                          {t.query}
                        </td>
                        <td className="px-3 py-2">
                          {t.status === "error" ? (
                            <span className="text-red-600 font-medium">
                              error{t.error_step ? ` (${t.error_step})` : ""}
                            </span>
                          ) : t.is_no_answer ? (
                            <span className="text-amber-600">no-answer</span>
                          ) : t.chunks_found === 0 ? (
                            <span className="text-amber-600">empty</span>
                          ) : (
                            <span className="text-green-600">ok</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{t.total_ms}ms</td>
                        <td className="px-3 py-2">
                          {t.top_relevance_score?.toFixed(3) ?? "—"}
                        </td>
                        <td className="px-3 py-2">{t.chunks_found}</td>
                        <td className="px-3 py-2 font-mono">
                          {t.cost_usd != null ? `$${Number(t.cost_usd).toFixed(6)}` : "—"}
                        </td>
                        <td className="px-3 py-2"><ScoreCell v={t.eval_faithfulness} /></td>
                        <td className="px-3 py-2"><ScoreCell v={t.eval_answer_relevance} /></td>
                        <td className="px-3 py-2">
                          {t.feedback === "thumbs_up" && <span className="text-green-600">+1</span>}
                          {t.feedback === "thumbs_down" && <span className="text-red-600">-1</span>}
                          {!t.feedback && <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/analytics/${t.trace_id}`}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            Details
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30 cursor-pointer"
                >
                  &larr; Previous
                </button>
                <span className="text-xs text-gray-400">Page {page}</span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={traces.length < 50}
                  className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-30 cursor-pointer"
                >
                  Next &rarr;
                </button>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, sub, alert }: {
  label: string;
  value: string | number;
  sub?: string;
  alert?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${alert ? "text-red-600" : "text-gray-900"}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  );
}

function ScoreCard({ label, value, hint }: {
  label: string;
  value: number | null;
  hint?: string;
}) {
  const display = value == null ? "—" : value.toFixed(3);
  const color =
    value == null
      ? "text-gray-300"
      : value < 0.5
        ? "text-red-600"
        : value < 0.75
          ? "text-amber-600"
          : "text-green-600";

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 font-mono ${color}`}>
        {display}
      </div>
      {hint && <div className="text-[10px] text-gray-400">{hint}</div>}
    </div>
  );
}

function ScoreCell({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="text-gray-300">—</span>;
  const color =
    v < 0.5 ? "text-red-600" : v < 0.75 ? "text-amber-600" : "text-green-600";
  return <span className={`font-mono ${color}`}>{v.toFixed(2)}</span>;
}
