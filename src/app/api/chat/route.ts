import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generateQueryEmbedding } from "@/lib/embeddings";
import { buildMessages, generateAnswerStream } from "@/lib/llm";
import { rerankChunks } from "@/lib/reranker";
import { PipelineTracer, hashIp } from "@/lib/tracer";

// Origins allowed to call this API cross-site (portfolio chat widget)
const ALLOWED_ORIGINS = new Set([
  "https://volodeveth.vercel.app",
  "http://localhost:3000",
  "http://localhost:3456",
]);

function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function POST(request: NextRequest) {
  const tracer = new PipelineTracer("");

  try {
    const { query } = await request.json();

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const trimmedQuery = query.trim();
    tracer.setQuery(trimmedQuery);

    // Request metadata
    const ua = request.headers.get("user-agent") || undefined;
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const ipHash = await hashIp(ip);
    tracer.setRequestMeta(ua, ipHash);

    // 1. Generate embedding for the query
    tracer.startStep("embedding");
    const { embedding: queryEmbedding, totalTokens: embedTokens } =
      await generateQueryEmbedding(trimmedQuery);
    tracer.endStep("embedding");
    tracer.addJinaEmbedTokens(embedTokens);

    // 2. Hybrid search: vector + full-text with RRF
    tracer.startStep("search");
    const supabase = createServiceClient();
    const { data: hybridChunks, error } = await supabase.rpc("hybrid_search", {
      query_text: trimmedQuery,
      query_embedding: queryEmbedding,
      match_count: 40,
    });
    tracer.endStep("search");

    if (error) {
      console.error("Supabase RPC error:", error);
      tracer.setError("search", error.message);
      tracer.save();
      return NextResponse.json(
        { error: "Search failed" },
        { status: 500, headers: corsHeaders(request) }
      );
    }

    tracer.setSearchResults(hybridChunks?.length ?? 0);

    // 3. If no relevant chunks found
    if (!hybridChunks || hybridChunks.length === 0) {
      tracer.save();
      return NextResponse.json(
        {
          answer:
            "I don't have relevant information in the documents to answer this question.",
          sources: [],
          traceId: tracer.traceId,
        },
        { headers: corsHeaders(request) }
      );
    }

    // 4. Rerank top chunks
    tracer.startStep("rerank");
    const { chunks: rerankedChunks, totalTokens: rerankTokens } =
      await rerankChunks(trimmedQuery, hybridChunks, 5);
    tracer.endStep("rerank");
    tracer.addJinaRerankTokens(rerankTokens);
    tracer.setRerankResults(rerankedChunks);

    // 5. Build sources metadata.
    // Client preview is truncated; the trace stores full content so that
    // the LLM-judge in /api/evaluate has the real chunks to score against.
    const sourcesForClient = rerankedChunks.map((c) => ({
      content: c.content.slice(0, 200) + "...",
      relevance: c.relevance_score,
      metadata: c.metadata,
    }));
    const sourcesForTrace = rerankedChunks.map((c) => ({
      content: c.content,
      relevance: c.relevance_score,
      metadata: c.metadata,
    }));
    tracer.setSources(sourcesForTrace);

    // 6. Stream the LLM response
    tracer.startStep("llm");
    const messages = buildMessages(trimmedQuery, rerankedChunks);
    const { stream: llmStream, getUsage } = await generateAnswerStream(messages);

    const encoder = new TextEncoder();
    const sourcesChunk = encoder.encode(
      `data: ${JSON.stringify({ sources: sourcesForClient, traceId: tracer.traceId })}\n\n`
    );

    let firstToken = true;

    const outputStream = new ReadableStream({
      async start(controller) {
        controller.enqueue(sourcesChunk);
        const reader = llmStream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = new TextDecoder().decode(value);

          if (firstToken) {
            tracer.markLlmTtfb();
            firstToken = false;
          }
          tracer.appendAnswer(text);

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ token: text })}\n\n`)
          );
        }

        tracer.endStep("llm");
        const { promptTokens, completionTokens } = getUsage();
        tracer.setLlmTokens(promptTokens, completionTokens);

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();

        // Save trace after stream completes (non-blocking)
        tracer.save();
      },
    });

    return new Response(outputStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...corsHeaders(request),
      },
    });
  } catch (err) {
    console.error("Chat API error:", err);
    tracer.setError("unknown", err instanceof Error ? err.message : "Unknown error");
    tracer.save();
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
