#!/usr/bin/env node
/**
 * Cron-friendly wrapper around POST /api/evaluate.
 *
 * Usage:
 *   EVAL_CRON_KEY=... BASE_URL=https://ask-about-dorosh.duckdns.org \
 *     node scripts/run-eval.cjs
 *
 * Recommended cron (every 15 min):
 *   star/15 * * * * EVAL_CRON_KEY=... BASE_URL=... node /home/ubuntu/rag-chat/scripts/run-eval.cjs
 */

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const EVAL_CRON_KEY = process.env.EVAL_CRON_KEY;
const BATCH_SIZE = parseInt(process.env.JUDGE_BATCH_SIZE || "20", 10);

if (!EVAL_CRON_KEY) {
  console.error("EVAL_CRON_KEY env var is required");
  process.exit(1);
}

(async () => {
  try {
    const res = await fetch(`${BASE_URL}/api/evaluate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Eval-Key": EVAL_CRON_KEY,
      },
      body: JSON.stringify({ batchSize: BATCH_SIZE }),
    });

    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    if (!res.ok) {
      console.error(`[${new Date().toISOString()}] eval failed:`, res.status, body);
      process.exit(2);
    }

    console.log(`[${new Date().toISOString()}] eval ok:`, JSON.stringify(body));
  } catch (err) {
    console.error(`[${new Date().toISOString()}] eval exception:`, err);
    process.exit(3);
  }
})();
