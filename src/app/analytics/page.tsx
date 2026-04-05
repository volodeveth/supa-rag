"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Summary {
  totalQueries: number;
  errors: number;
  errorRate: number;
  thumbsUp: number;
  thumbsDown: number;
  feedbackRate: number;
  satisfactionRate: number;
  avgLatency: number;
  avgRelevance: number;
  days: number;
}

interface DailyRow {
  day: string;
  total_queries: number;
  errors: number;
  thumbs_up: number;
  thumbs_down: number;
  avg_total_ms: number;
  avg_embedding_ms: number;
  avg_search_ms: number;
  avg_rerank_ms: number;
  avg_llm_ms: number;
  avg_top_relevance: number;
  avg_chunks_found: number;
  total_jina_tokens: number;
  total_llm_tokens: number;
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
}

type FeedbackFilter = "all" | "thumbs_up" | "thumbs_down" | "none";
type StatusFilter = "all" | "success" | "error";

export default function AnalyticsDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [days, setDays] = useState(30);
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      days: days.toString(),
      page: page.toString(),
      limit: "50",
    });
    if (feedbackFilter !== "all") params.set("feedback", feedbackFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);

    try {
      const res = await fetch(`/api/analytics?${params}`);
      const data = await res.json();
      setSummary(data.summary);
      setDaily(data.daily || []);
      setTraces(data.traces || []);
    } catch {
      console.error("Failed to fetch analytics");
    } finally {
      setLoading(false);
    }
  }, [days, feedbackFilter, statusFilter, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">RAG Analytics</h1>
            <p className="text-sm text-gray-500">Monitoring, evaluation & observability</p>
          </div>
          <Link
            href="/"
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            &larr; Back to chat
          </Link>
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
        </div>

        {loading && !summary ? (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        ) : (
          <>
            {/* Summary Cards */}
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                <StatCard label="Total Queries" value={summary.totalQueries} />
                <StatCard label="Avg Latency" value={`${summary.avgLatency}ms`} />
                <StatCard label="Avg Relevance" value={summary.avgRelevance.toFixed(3)} />
                <StatCard
                  label="Error Rate"
                  value={`${summary.errorRate}%`}
                  alert={summary.errorRate > 5}
                />
                <StatCard label="Satisfaction" value={`${summary.satisfactionRate}%`} />
                <StatCard
                  label="Feedback"
                  value={`${summary.thumbsUp} / ${summary.thumbsDown}`}
                  sub="up / down"
                />
              </div>
            )}

            {/* Daily Chart (table-based) */}
            {daily.length > 0 && (
              <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <h2 className="px-4 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">
                  Daily Breakdown
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 text-left">
                        <th className="px-4 py-2 font-medium">Date</th>
                        <th className="px-4 py-2 font-medium">Queries</th>
                        <th className="px-4 py-2 font-medium">Errors</th>
                        <th className="px-4 py-2 font-medium">Avg Total</th>
                        <th className="px-4 py-2 font-medium">Embed</th>
                        <th className="px-4 py-2 font-medium">Search</th>
                        <th className="px-4 py-2 font-medium">Rerank</th>
                        <th className="px-4 py-2 font-medium">LLM</th>
                        <th className="px-4 py-2 font-medium">Relevance</th>
                        <th className="px-4 py-2 font-medium">Jina Tokens</th>
                        <th className="px-4 py-2 font-medium">LLM Tokens</th>
                        <th className="px-4 py-2 font-medium">Feedback</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map((row) => (
                        <tr key={row.day} className="border-t border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono">{row.day}</td>
                          <td className="px-4 py-2">{row.total_queries}</td>
                          <td className="px-4 py-2">
                            <span className={row.errors > 0 ? "text-red-600 font-medium" : ""}>
                              {row.errors}
                            </span>
                          </td>
                          <td className="px-4 py-2">{row.avg_total_ms}ms</td>
                          <td className="px-4 py-2">{row.avg_embedding_ms}ms</td>
                          <td className="px-4 py-2">{row.avg_search_ms}ms</td>
                          <td className="px-4 py-2">{row.avg_rerank_ms}ms</td>
                          <td className="px-4 py-2">{row.avg_llm_ms}ms</td>
                          <td className="px-4 py-2">{row.avg_top_relevance}</td>
                          <td className="px-4 py-2">{(row.total_jina_tokens ?? 0).toLocaleString()}</td>
                          <td className="px-4 py-2">{(row.total_llm_tokens ?? 0).toLocaleString()}</td>
                          <td className="px-4 py-2">
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

            {/* Traces List */}
            <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <h2 className="px-4 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">
                Recent Traces
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-left">
                      <th className="px-4 py-2 font-medium">Time</th>
                      <th className="px-4 py-2 font-medium">Query</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Latency</th>
                      <th className="px-4 py-2 font-medium">Relevance</th>
                      <th className="px-4 py-2 font-medium">Chunks</th>
                      <th className="px-4 py-2 font-medium">Feedback</th>
                      <th className="px-4 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {traces.map((t) => (
                      <tr key={t.trace_id} className="border-t border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-gray-400 whitespace-nowrap">
                          {new Date(t.created_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 max-w-xs truncate" title={t.query}>
                          {t.query}
                        </td>
                        <td className="px-4 py-2">
                          {t.status === "error" ? (
                            <span className="text-red-600 font-medium">
                              error{t.error_step ? ` (${t.error_step})` : ""}
                            </span>
                          ) : (
                            <span className="text-green-600">ok</span>
                          )}
                        </td>
                        <td className="px-4 py-2">{t.total_ms}ms</td>
                        <td className="px-4 py-2">
                          {t.top_relevance_score?.toFixed(3) ?? "—"}
                        </td>
                        <td className="px-4 py-2">{t.chunks_found}</td>
                        <td className="px-4 py-2">
                          {t.feedback === "thumbs_up" && <span className="text-green-600">+1</span>}
                          {t.feedback === "thumbs_down" && <span className="text-red-600">-1</span>}
                          {!t.feedback && <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2">
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

              {/* Pagination */}
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
