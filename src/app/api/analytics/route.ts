import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.min(parseInt(searchParams.get("days") || "30"), 90);
    const feedback = searchParams.get("feedback"); // thumbs_up | thumbs_down | null
    const status = searchParams.get("status"); // success | error | null
    const page = Math.max(parseInt(searchParams.get("page") || "1"), 1);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const traceId = searchParams.get("traceId");

    const supabase = createServiceClient();

    // Single trace detail
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

    // Aggregated daily stats
    const { data: daily, error: dailyErr } = await supabase
      .from("chat_analytics_daily")
      .select("*")
      .gte("day", since.toISOString().split("T")[0])
      .order("day", { ascending: false });

    if (dailyErr) {
      console.error("Analytics daily error:", dailyErr);
    }

    // Summary stats
    const { data: summary } = await supabase
      .from("chat_traces")
      .select("status, feedback, total_ms, top_relevance_score", { count: "exact" })
      .gte("created_at", since.toISOString());

    const totalQueries = summary?.length ?? 0;
    const errors = summary?.filter((r) => r.status === "error").length ?? 0;
    const thumbsUp = summary?.filter((r) => r.feedback === "thumbs_up").length ?? 0;
    const thumbsDown = summary?.filter((r) => r.feedback === "thumbs_down").length ?? 0;
    const avgLatency = totalQueries > 0
      ? Math.round(summary!.reduce((s, r) => s + (r.total_ms || 0), 0) / totalQueries)
      : 0;
    const avgRelevance = totalQueries > 0
      ? +(summary!.reduce((s, r) => s + (r.top_relevance_score || 0), 0) / totalQueries).toFixed(3)
      : 0;

    // Recent traces list (paginated, filterable)
    let tracesQuery = supabase
      .from("chat_traces")
      .select("trace_id, query, status, feedback, total_ms, top_relevance_score, chunks_found, created_at, error_step")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (feedback === "thumbs_up" || feedback === "thumbs_down") {
      tracesQuery = tracesQuery.eq("feedback", feedback);
    }
    if (feedback === "none") {
      tracesQuery = tracesQuery.is("feedback", null);
    }
    if (status === "success" || status === "error") {
      tracesQuery = tracesQuery.eq("status", status);
    }

    const { data: traces, error: tracesErr } = await tracesQuery;

    if (tracesErr) {
      console.error("Analytics traces error:", tracesErr);
    }

    return NextResponse.json({
      summary: {
        totalQueries,
        errors,
        errorRate: totalQueries > 0 ? +(errors / totalQueries * 100).toFixed(1) : 0,
        thumbsUp,
        thumbsDown,
        feedbackRate: totalQueries > 0
          ? +((thumbsUp + thumbsDown) / totalQueries * 100).toFixed(1)
          : 0,
        satisfactionRate: (thumbsUp + thumbsDown) > 0
          ? +(thumbsUp / (thumbsUp + thumbsDown) * 100).toFixed(1)
          : 0,
        avgLatency,
        avgRelevance,
        days,
      },
      daily: daily || [],
      traces: traces || [],
      page,
      limit,
    });
  } catch (err) {
    console.error("Analytics error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
