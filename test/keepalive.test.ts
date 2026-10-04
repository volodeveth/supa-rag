// Keep-alive for the free Supabase project, which pauses after 7 days without activity.
// Vercel Cron calls GET /api/keepalive and sends `Authorization: Bearer $CRON_SECRET`.
// The route must run a real query through the REST API, so the database sees activity.
//
// Run: npx tsx --test test/keepalive.test.ts
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

let server: http.Server;
let hits: string[] = [];
let dbStatus = 200;

before(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url || "");
    res.writeHead(dbStatus, { "Content-Type": "application/json", "Content-Range": "0-0/1" });
    res.end(dbStatus === 200 ? JSON.stringify([{ id: 1 }]) : JSON.stringify({ message: "paused" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

after(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  hits = [];
  dbStatus = 200;
  process.env.CRON_SECRET = "s3cret";
});

async function call(auth?: string) {
  const { GET } = await import("../src/app/api/keepalive/route");
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  return GET(new Request("http://localhost/api/keepalive", { headers }) as never);
}

const dbHits = () => hits.filter((u) => u.startsWith("/rest/v1/"));

test("valid cron secret → queries the documents table and returns 200", async () => {
  const res = await call("Bearer s3cret");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(
    dbHits().some((u) => u.startsWith("/rest/v1/documents")),
    `expected a request to /rest/v1/documents, got: ${JSON.stringify(hits)}`
  );
});

test("missing Authorization → 401 and no database request", async () => {
  const res = await call();
  assert.equal(res.status, 401);
  assert.equal(dbHits().length, 0);
});

test("wrong secret → 401 and no database request", async () => {
  const res = await call("Bearer nope");
  assert.equal(res.status, 401);
  assert.equal(dbHits().length, 0);
});

test("CRON_SECRET not configured → request is refused, never open to the public", async () => {
  delete process.env.CRON_SECRET;
  const res = await call("Bearer undefined");
  assert.ok(res.status >= 400, `expected an error status, got ${res.status}`);
  assert.equal(dbHits().length, 0);
});

test("database error → 503 with ok:false, so the cron run shows as failed", async () => {
  dbStatus = 500;
  const res = await call("Bearer s3cret");
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
});
