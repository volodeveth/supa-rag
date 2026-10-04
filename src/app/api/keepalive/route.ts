import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function isAuthorized(authorization: string | null, secret: string): boolean {
  if (authorization === null) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return json({ ok: false, error: "CRON_SECRET is not configured" }, 503);
  }

  if (!isAuthorized(request.headers.get("authorization"), secret)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    const { error } = await createServiceClient()
      .from("documents")
      .select("id")
      .limit(1);

    if (error) {
      const message = error.message.slice(0, 200);
      console.error("Keep-alive database query failed:", message);
      return json({ ok: false, error: message }, 503);
    }

    return json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 200) : "Database query failed";
    console.error("Keep-alive database query failed:", message);
    return json({ ok: false, error: message }, 503);
  }
}
