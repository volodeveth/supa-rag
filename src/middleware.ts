import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "analytics_auth";
const SALT = "rag-analytics-v1";

let cachedToken: string | null = null;

async function expectedToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const password = process.env.ANALYTICS_PASSWORD || "123456789";
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
  cachedToken = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return cachedToken;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Login endpoints are public
  if (pathname === "/analytics/login" || pathname === "/api/analytics/login") {
    return NextResponse.next();
  }

  // Header auth for cron/automation hitting /api/evaluate
  const evalKey = process.env.EVAL_CRON_KEY;
  if (
    evalKey &&
    pathname.startsWith("/api/evaluate") &&
    request.headers.get("x-eval-key") === evalKey
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const expected = await expectedToken();

  if (token === expected) {
    return NextResponse.next();
  }

  // API: 401 JSON
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Page: redirect to login with return path
  const url = request.nextUrl.clone();
  url.pathname = "/analytics/login";
  url.searchParams.set("redirect", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/analytics",
    "/analytics/:path*",
    "/api/analytics",
    "/api/analytics/:path*",
    "/api/evaluate",
    "/api/evaluate/:path*",
  ],
};

export const ANALYTICS_AUTH_COOKIE = COOKIE_NAME;
export { expectedToken };
