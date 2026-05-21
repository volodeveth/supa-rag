"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") || "/analytics";

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/analytics/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        router.replace(redirect);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Invalid code");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 px-6 py-7 shadow-sm"
      >
        <h1 className="text-lg font-semibold text-gray-900">Analytics access</h1>
        <p className="text-sm text-gray-500 mt-1">
          Enter the access code to view RAG analytics.
        </p>

        <div className="mt-5">
          <label className="text-xs font-medium text-gray-600 block mb-1.5">
            Access code
          </label>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="•••••••••"
          />
        </div>

        {error && (
          <p className="mt-3 text-xs text-red-600">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || code.length === 0}
          className="mt-5 w-full bg-blue-600 text-white text-sm font-medium rounded-lg py-2 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          {loading ? "Checking..." : "Unlock"}
        </button>

        <div className="mt-4 text-center">
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-700">
            &larr; Back to chat
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function AnalyticsLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <LoginForm />
    </Suspense>
  );
}
