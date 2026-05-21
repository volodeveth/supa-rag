import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

type FeedbackFilter = "thumbs_up" | "thumbs_down" | "none";
type StatusFilter = "success" | "error";
type CategoryFilter = "problematic" | "no_answer" | "empty_retrieval" | "low_faithfulness";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(parseInt(searchParams.get("days") || "30"), 90);
    const feedback = searchParams.get("feedback") as FeedbackFilter | null;
    const status = searchParams.get("status") as StatusFilter | null;
    const category = searchParams.get("category") as CategoryFilter | null;
    const page = Math.max(parseInt(searchParams.get("page") || "1"), 1);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const traceId = searchParams.get("traceId");

    const supabase = createServiceClient();

    // ---- Single trace detail
    if (traceId) {
      const { data, error } = await supabase
        .from("chat_traces")
        .select("*")
        .eq("trace_id", traceId)
        .single();

      if (error || !data) {
        return NextResponse.json({ error: "Trace not found" }, { status: 404 });
      }
      return NextResponse.json({ trace: data });
    }

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceIso = since.toISOString();

    // ---- Daily aggregates (uses view)
    const { data: daily, error: dailyErr } = await supabase
      .from("chat_analytics_daily")
      .select("*")
      .gte("day", sinceIso.split("T")[0])
      .order("day", { ascending: false });
    if (dailyErr) console.error("Analytics daily error:", dailyErr);

    // ---- Relevance histogram (view; recomputes for last 30 days regardless)
    const { data: histogram, error: histErr } = await supabase
      .from("chat_relevance_histogram")
      .select("*");
    if (histErr) console.error("Histogram error:", histErr);

    // ---- Summary set (raw traces in window for in-app aggregation)
    const { data: summaryRows } = await supabase
      .from("chat_traces")
      .select(
        "status, feedback, total_ms, top_relevance_score, cost_usd, is_no_answer, chunks_found, eval_faithfulness, eval_answer_relevance, eval_context_relevance, eval_context_sufficiency, eval_at"
      )
      .gte("created_at", sinceIso);

    const rows = summaryRows ?? [];
    const totalQueries = rows.length;
    const errors = rows.filter((r) => r.status === "error").length;
    const noAnswers = rows.filter((r) => r.is_no_answer).length;
    const emptyRetrievals = rows.filter((r) => (r.chunks_found ?? 0) === 0).length;
    const thumbsUp = rows.filter((r) => r.feedback === "thumbs_up").length;
    const thumbsDown = rows.filter((r) => r.feedback === "thumbs_down").length;

    const latencies = rows
      .map((r) => r.total_ms)
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);

    const avgLatency = latencies.length
      ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
      : 0;
    const p50 = Math.round(percentile(latencies, 0.5));
    const p95 = Math.round(percentile(latencies, 0.95));
    const p99 = Math.round(percentile(latencies, 0.99));

    const avgRelevance =
      totalQueries > 0
        ? +(
            rows.reduce((s, r) => s + (r.top_relevance_score || 0), 0) /
            totalQueries
          ).toFixed(3)
        : 0;

    const totalCostUsd = +rows
      .reduce((s, r) => s + Number(r.cost_usd || 0), 0)
      .toFixed(6);
    const avgCostUsd =
      totalQueries > 0 ? +(totalCostUsd / totalQueries).toFixed(8) : 0;

    // ---- Eval averages (skip nulls)
    function avg(field: keyof (typeof rows)[number]): number | null {
      const vals = rows
        .map((r) => r[field] as number | null)
        .filter((v): v is number => typeof v === "number");
      if (vals.length === 0) return null;
      return +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(3);
    }
    const evaluatedCount = rows.filter((r) => r.eval_at != null).length;

    // ---- Traces list (paginated, filtered)
    let tracesQuery = supabase
      .from("chat_traces")
      .select(
        "trace_id, query, status, feedback, total_ms, top_relevance_score, chunks_found, created_at, error_step, is_no_answer, cost_usd, eval_faithfulness, eval_answer_relevance, eval_at"
      )
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (feedback === "thumbs_up" || feedback === "thumbs_down") {
      tracesQuery = tracesQuery.eq("feedback", feedback);
    } else if (feedback === "none") {
      tracesQuery = tracesQuery.is("feedback", null);
    }
    if (status === "success" || status === "error") {
      tracesQuery = tracesQuery.eq("status", status);
    }
    if (category === "no_answer") {
      tracesQuery = tracesQuery.eq("is_no_answer", true);
    } else if (category === "empty_retrieval") {
      tracesQuery = tracesQuery.eq("chunks_found", 0);
    } else if (category === "low_faithfulness") {
      tracesQuery = tracesQuery.lt("eval_faithfulness", 0.5);
    } else if (category === "problematic") {
      // Problematic = error OR thumbs_down OR no_answer OR empty_retrieval.
      // PostgREST OR expression on multiple columns.
      tracesQuery = tracesQuery.or(
        "status.eq.error,feedback.eq.thumbs_down,is_no_answer.eq.true,chunks_found.eq.0"
      );
    }

    const { data: traces, error: tracesErr } = await tracesQuery;
    if (tracesErr) console.error("Analytics traces error:", tracesErr);

    return NextResponse.json({
      summary: {
        totalQueries,
        errors,
        errorRate: totalQueries > 0 ? +((errors / totalQueries) * 100).toFixed(1) : 0,
        noAnswers,
        noAnswerRate:
          totalQueries > 0 ? +((noAnswers / totalQueries) * 100).toFixed(1) : 0,
        emptyRetrievals,
        emptyRetrievalRate:
          totalQueries > 0
            ? +((emptyRetrievals / totalQueries) * 100).toFixed(1)
            : 0,
        thumbsUp,
        thumbsDown,
        feedbackRate:
          totalQueries > 0
            ? +(((thumbsUp + thumbsDown) / totalQueries) * 100).toFixed(1)
            : 0,
        satisfactionRate:
          thumbsUp + thumbsDown > 0
            ? +((thumbsUp / (thumbsUp + thumbsDown)) * 100).toFixed(1)
            : 0,
        avgLatency,
        p50Latency: p50,
        p95Latency: p95,
        p99Latency: p99,
        avgRelevance,
        totalCostUsd,
        avgCostUsd,
        eval: {
          evaluatedCount,
          evaluatedRate:
            totalQueries > 0
              ? +((evaluatedCount / totalQueries) * 100).toFixed(1)
              : 0,
          avgFaithfulness: avg("eval_faithfulness"),
          avgAnswerRelevance: avg("eval_answer_relevance"),
          avgContextRelevance: avg("eval_context_relevance"),
          avgContextSufficiency: avg("eval_context_sufficiency"),
        },
        days,
      },
      daily: daily || [],
      histogram: histogram || [],
      traces: traces || [],
      page,
      limit,
    });
  } catch (err) {
    console.error("Analytics error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
