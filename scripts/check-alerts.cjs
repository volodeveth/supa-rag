#!/usr/bin/env node
/**
 * Threshold alerts over chat_traces, delivered to Telegram.
 *
 * Runs outside the app on purpose: the dashboard cannot report that the service
 * is down, because a dead service writes no traces. The dead-man's switch below
 * is the only check here that fires on *absence* of data.
 *
 * Usage:
 *   node scripts/check-alerts.cjs
 *
 * Required env (reads .env.local when present):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID     (omit both → prints to stdout only)
 *
 * Optional thresholds (defaults in THRESHOLDS below):
 *   ALERT_P95_MS, ALERT_COST_PER_QUERY, ALERT_MIN_FAITHFULNESS,
 *   ALERT_MAX_NO_ANSWER_RATE, ALERT_MAX_ERROR_RATE, ALERT_MAX_EVAL_BACKLOG,
 *   ALERT_SILENCE_HOURS, ALERT_WINDOW_HOURS
 *
 * Recommended cron (hourly):
 *   0 * * * * cd /home/ubuntu/rag-chat && node scripts/check-alerts.cjs >> /var/log/rag-alerts.log 2>&1
 */

const fs = require("fs");
const path = require("path");

// --- env -------------------------------------------------------------------

const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const num = (name, fallback) => {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
};

const THRESHOLDS = {
  windowHours: num("ALERT_WINDOW_HOURS", 24),
  p95Ms: num("ALERT_P95_MS", 20000),
  costPerQuery: num("ALERT_COST_PER_QUERY", 0.002),
  minFaithfulness: num("ALERT_MIN_FAITHFULNESS", 0.7),
  maxNoAnswerRate: num("ALERT_MAX_NO_ANSWER_RATE", 0.25),
  maxErrorRate: num("ALERT_MAX_ERROR_RATE", 0.05),
  maxEvalBacklog: num("ALERT_MAX_EVAL_BACKLOG", 50),
  silenceHours: num("ALERT_SILENCE_HOURS", 48),
};

// --- data ------------------------------------------------------------------

async function fetchTraces(sinceIso) {
  const params = new URLSearchParams({
    select:
      "trace_id,created_at,total_ms,cost_usd,status,is_no_answer,eval_at,eval_faithfulness,chunks_found",
    created_at: `gte.${sinceIso}`,
    order: "created_at.desc",
    limit: "5000",
  });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_traces?${params}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

async function fetchLatestTraceAt() {
  const params = new URLSearchParams({
    select: "created_at",
    order: "created_at.desc",
    limit: "1",
  });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/chat_traces?${params}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.created_at ?? null;
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

// --- checks ----------------------------------------------------------------

function evaluate(traces, latestTraceAt) {
  const alerts = [];
  const t = THRESHOLDS;

  // Dead-man's switch first: it is the one check that fires on missing data,
  // and every other check below is meaningless when nothing is arriving.
  const lastSeen = latestTraceAt ? new Date(latestTraceAt) : null;
  const silentHours = lastSeen
    ? (Date.now() - lastSeen.getTime()) / 3_600_000
    : Infinity;
  if (silentHours > t.silenceHours) {
    alerts.push(
      `🔇 No traces for ${silentHours === Infinity ? "ever" : silentHours.toFixed(1) + "h"} ` +
        `(limit ${t.silenceHours}h) — service may be down, not idle`
    );
  }

  if (traces.length === 0) {
    return { alerts, summary: { total: 0, silentHours } };
  }

  const total = traces.length;
  const errors = traces.filter((r) => r.status === "error").length;
  const noAnswers = traces.filter((r) => r.is_no_answer).length;
  const latencies = traces.map((r) => r.total_ms).filter((v) => v != null);
  const p95 = percentile(latencies, 95);
  const costs = traces.map((r) => Number(r.cost_usd) || 0);
  const avgCost = costs.reduce((a, b) => a + b, 0) / total;

  const judged = traces.filter((r) => r.eval_faithfulness != null);
  const avgFaith = judged.length
    ? judged.reduce((a, r) => a + r.eval_faithfulness, 0) / judged.length
    : null;

  const backlog = traces.filter(
    (r) => r.eval_at == null && r.status === "success" && r.chunks_found > 0
  ).length;

  const errorRate = errors / total;
  const noAnswerRate = noAnswers / total;

  if (p95 != null && p95 > t.p95Ms) {
    alerts.push(`🐌 p95 latency ${Math.round(p95)}ms > ${t.p95Ms}ms`);
  }
  if (avgCost > t.costPerQuery) {
    alerts.push(`💸 cost/query $${avgCost.toFixed(6)} > $${t.costPerQuery}`);
  }
  if (avgFaith != null && avgFaith < t.minFaithfulness) {
    alerts.push(
      `🎭 faithfulness ${avgFaith.toFixed(3)} < ${t.minFaithfulness} (${judged.length} judged) — answers drifting from context`
    );
  }
  if (noAnswerRate > t.maxNoAnswerRate) {
    alerts.push(
      `🤷 no-answer rate ${(noAnswerRate * 100).toFixed(1)}% > ${(t.maxNoAnswerRate * 100).toFixed(0)}% — retrieval is missing`
    );
  }
  if (errorRate > t.maxErrorRate) {
    alerts.push(
      `💥 error rate ${(errorRate * 100).toFixed(1)}% > ${(t.maxErrorRate * 100).toFixed(0)}%`
    );
  }
  if (backlog > t.maxEvalBacklog) {
    alerts.push(`⏳ eval backlog ${backlog} > ${t.maxEvalBacklog} — judge cron may be stuck`);
  }

  return {
    alerts,
    summary: {
      total,
      p95,
      avgCost,
      avgFaith,
      judged: judged.length,
      errorRate,
      noAnswerRate,
      backlog,
      silentHours,
    },
  };
}

// --- delivery --------------------------------------------------------------

async function notify(text) {
  if (!TG_TOKEN || !TG_CHAT) {
    console.log("[no telegram configured] would send:\n" + text);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_CHAT,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    console.error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

// --- main ------------------------------------------------------------------

(async () => {
  const since = new Date(
    Date.now() - THRESHOLDS.windowHours * 3_600_000
  ).toISOString();

  const [traces, latestTraceAt] = await Promise.all([
    fetchTraces(since),
    fetchLatestTraceAt(),
  ]);

  const { alerts, summary } = evaluate(traces, latestTraceAt);

  console.log(
    `[${new Date().toISOString()}] window=${THRESHOLDS.windowHours}h ` +
      `traces=${summary.total} alerts=${alerts.length}`
  );
  console.log(JSON.stringify(summary));

  if (alerts.length === 0) {
    console.log("OK — no thresholds breached");
    return;
  }

  const body = [
    `<b>RAG alerts</b> — last ${THRESHOLDS.windowHours}h, ${summary.total} queries`,
    "",
    ...alerts,
    "",
    "https://ask-about-dorosh.duckdns.org/analytics",
  ].join("\n");

  await notify(body);
  process.exitCode = 1; // non-zero so a cron wrapper can react too
})().catch((err) => {
  console.error("Alert check failed:", err.message);
  process.exit(2);
});
