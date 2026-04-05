import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generateQueryEmbedding } from "@/lib/embeddings";
import { buildMessages, generateAnswerStream } from "@/lib/llm";
import { rerankChunks } from "@/lib/reranker";
import { PipelineTracer, hashIp } from "@/lib/tracer";

export async function POST(request: NextRequest) {
  const tracer = new PipelineTracer("");

  try {
    const { query } = await request.json();

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400 }
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
        { status: 500 }
      );
    }

    tracer.setSearchResults(hybridChunks?.length ?? 0);

    // 3. If no relevant chunks found
    if (!hybridChunks || hybridChunks.length === 0) {
      tracer.save();
      return NextResponse.json({
        answer:
          "I don't have relevant information in the documents to answer this question.",
        sources: [],
        traceId: tracer.traceId,
      });
    }

    // 4. Rerank top chunks
    tracer.startStep("rerank");
    const { chunks: rerankedChunks, totalTokens: rerankTokens } =
      await rerankChunks(trimmedQuery, hybridChunks, 10);
    tracer.endStep("rerank");
    tracer.addJinaRerankTokens(rerankTokens);
    tracer.setRerankResults(rerankedChunks);

    // 5. Build sources metadata
    const sources = rerankedChunks.map((c) => ({
      content: c.content.slice(0, 200) + "...",
      relevance: c.relevance_score,
      metadata: c.metadata,
    }));
    tracer.setSources(sources);

    // 6. Stream the LLM response
    tracer.startStep("llm");
    const messages = buildMessages(trimmedQuery, rerankedChunks);
    const { stream: llmStream, getUsage } = await generateAnswerStream(messages);

    const encoder = new TextEncoder();
    const sourcesChunk = encoder.encode(
      `data: ${JSON.stringify({ sources, traceId: tracer.traceId })}\n\n`
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
      },
    });
  } catch (err) {
    console.error("Chat API error:", err);
    tracer.setError("unknown", err instanceof Error ? err.message : "Unknown error");
    tracer.save();
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
