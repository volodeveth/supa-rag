import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "analytics_auth";
const SALT = "rag-analytics-v1";
const SEVEN_DAYS = 60 * 60 * 24 * 7;

async function computeToken(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(SALT)
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();
    const expected = process.env.ANALYTICS_PASSWORD || "123456789";

    if (typeof code !== "string" || code !== expected) {
      return NextResponse.json({ error: "Invalid code" }, { status: 401 });
    }

    const token = await computeToken(expected);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SEVEN_DAYS,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(COOKIE_NAME);
  return response;
}
