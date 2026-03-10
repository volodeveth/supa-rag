import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generateQueryEmbedding } from "@/lib/embeddings";
import { buildMessages, generateAnswerStream } from "@/lib/llm";
import { rerankChunks } from "@/lib/reranker";

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400 }
      );
    }

    const trimmedQuery = query.trim();

    // 1. Generate embedding for the query
    const queryEmbedding = await generateQueryEmbedding(trimmedQuery);

    // 2. Hybrid search: vector + full-text with RRF
    const supabase = createServiceClient();
    const { data: hybridChunks, error } = await supabase.rpc("hybrid_search", {
      query_text: trimmedQuery,
      query_embedding: queryEmbedding,
      match_count: 20,
    });

    if (error) {
      console.error("Supabase RPC error:", error);
      return NextResponse.json(
        { error: "Search failed" },
        { status: 500 }
      );
    }

    // 3. If no relevant chunks found
    if (!hybridChunks || hybridChunks.length === 0) {
      return NextResponse.json({
        answer:
          "I don't have relevant information in the documents to answer this question.",
        sources: [],
      });
    }

    // 4. Rerank top 20 → top 5
    const rerankedChunks = await rerankChunks(trimmedQuery, hybridChunks, 5);

    // 5. Build sources metadata
    const sources = rerankedChunks.map((c) => ({
      content: c.content.slice(0, 200) + "...",
      relevance: c.relevance_score,
      metadata: c.metadata,
    }));

    // 6. Stream the LLM response
    const messages = buildMessages(trimmedQuery, rerankedChunks);
    const llmStream = await generateAnswerStream(messages);

    const encoder = new TextEncoder();
    const sourcesChunk = encoder.encode(
      `data: ${JSON.stringify({ sources })}\n\n`
    );

    const outputStream = new ReadableStream({
      async start(controller) {
        controller.enqueue(sourcesChunk);
        const reader = llmStream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = new TextDecoder().decode(value);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ token: text })}\n\n`)
          );
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
