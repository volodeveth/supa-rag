import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { judgeTrace, JUDGE_MODEL } from "@/lib/judge";

interface TraceRow {
  trace_id: string;
  query: string;
  answer: string | null;
  sources: Array<{ content: string; relevance?: number }> | null;
}

const DEFAULT_BATCH = parseInt(process.env.JUDGE_BATCH_SIZE || "20");
const DEFAULT_DELAY_MS = parseInt(process.env.JUDGE_DELAY_MS || "3500");
const MAX_BATCH = 100;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(request: NextRequest) {
  let batchSize = DEFAULT_BATCH;
  let delayMs = DEFAULT_DELAY_MS;
  let traceIds: string[] | undefined;

  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.batchSize === "number") {
      batchSize = Math.max(1, Math.min(body.batchSize, MAX_BATCH));
    }
    if (typeof body.delayMs === "number") {
      delayMs = Math.max(0, Math.min(body.delayMs, 30_000));
    }
    if (Array.isArray(body.traceIds)) {
      traceIds = body.traceIds.filter((v: unknown) => typeof v === "string");
    }
  } catch {
    /* fall back to defaults */
  }

  const supabase = createServiceClient();

  // Pick the queue.
  let query = supabase
    .from("chat_traces")
    .select("trace_id, query, answer, sources")
    .eq("status", "success")
    .not("answer", "is", null)
    .not("sources", "is", null)
    .gt("chunks_found", 0)
    .is("eval_at", null)
    .order("created_at", { ascending: false })
    .limit(batchSize);

  if (traceIds && traceIds.length > 0) {
    // Manual re-eval mode: skip "eval_at is null" filter so we can re-judge specific traces.
    query = supabase
      .from("chat_traces")
      .select("trace_id, query, answer, sources")
      .in("trace_id", traceIds)
      .eq("status", "success")
      .not("answer", "is", null)
      .not("sources", "is", null)
      .gt("chunks_found", 0);
  }

  const { data: rows, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch traces", details: error.message },
      { status: 500 }
    );
  }

  const traces = (rows ?? []) as TraceRow[];
  if (traces.length === 0) {
    return NextResponse.json({
      evaluated: 0,
      failed: 0,
      skipped: 0,
      judge: JUDGE_MODEL,
      message: "No eligible traces to evaluate",
    });
  }

  let evaluated = 0;
  let failed = 0;
  let skipped = 0;
  const errors: Array<{ trace_id: string; reason: string }> = [];

  for (let i = 0; i < traces.length; i++) {
    const t = traces[i];

    if (!t.answer || !t.sources || t.sources.length === 0) {
      skipped++;
      continue;
    }

    try {
      const scores = await judgeTrace({
        query: t.query,
        answer: t.answer,
        sources: t.sources,
      });

      if (!scores) {
        failed++;
        errors.push({ trace_id: t.trace_id, reason: "Judge returned no JSON" });
        continue;
      }

      const { error: updateErr } = await supabase
        .from("chat_traces")
        .update({
          eval_faithfulness: scores.faithfulness,
          eval_answer_relevance: scores.answer_relevance,
          eval_context_relevance: scores.context_relevance,
          eval_context_sufficiency: scores.context_sufficiency,
          eval_judge_model: JUDGE_MODEL,
          eval_reasoning: { reasoning: scores.reasoning },
          eval_at: new Date().toISOString(),
        })
        .eq("trace_id", t.trace_id);

      if (updateErr) {
        failed++;
        errors.push({ trace_id: t.trace_id, reason: updateErr.message });
      } else {
        evaluated++;
      }
    } catch (err) {
      failed++;
      errors.push({
        trace_id: t.trace_id,
        reason: err instanceof Error ? err.message : "unknown",
      });
    }

    // Throttle between calls to stay under free-tier rate limit.
    if (i < traces.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return NextResponse.json({
    evaluated,
    failed,
    skipped,
    total: traces.length,
    judge: JUDGE_MODEL,
    errors: errors.slice(0, 10),
  });
}

export async function GET() {
  // Queue size for monitoring.
  const supabase = createServiceClient();
  const { count: pending } = await supabase
    .from("chat_traces")
    .select("trace_id", { count: "exact", head: true })
    .eq("status", "success")
    .not("answer", "is", null)
    .not("sources", "is", null)
    .gt("chunks_found", 0)
    .is("eval_at", null);

  const { count: evaluated } = await supabase
    .from("chat_traces")
    .select("trace_id", { count: "exact", head: true })
    .not("eval_at", "is", null);

  return NextResponse.json({
    pending: pending ?? 0,
    evaluated: evaluated ?? 0,
    judge: JUDGE_MODEL,
    batchSize: DEFAULT_BATCH,
    delayMs: DEFAULT_DELAY_MS,
  });
}
