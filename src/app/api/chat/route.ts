import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { generateQueryEmbedding } from "@/lib/embeddings";
import { buildMessages, generateAnswer } from "@/lib/llm";

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400 }
      );
    }

    // 1. Generate embedding for the query
    const queryEmbedding = await generateQueryEmbedding(query.trim());

    // 2. Search similar documents in Supabase
    const supabase = createServiceClient();
    const { data: chunks, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.3,
      match_count: 5,
    });

    if (error) {
      console.error("Supabase RPC error:", error);
      return NextResponse.json(
        { error: "Search failed" },
        { status: 500 }
      );
    }

    // 3. If no relevant chunks found
    if (!chunks || chunks.length === 0) {
      return NextResponse.json({
        answer:
          "I don't have relevant information in the documents to answer this question.",
        sources: [],
      });
    }

    // 4. Generate answer using DeepSeek V3
    const messages = buildMessages(query.trim(), chunks);
    const answer = await generateAnswer(messages);

    return NextResponse.json({
      answer,
      sources: chunks.map(
        (c: {
          content: string;
          similarity: number;
          metadata: Record<string, unknown>;
        }) => ({
          content: c.content.slice(0, 200) + "...",
          similarity: c.similarity,
          metadata: c.metadata,
        })
      ),
    });
  } catch (err) {
    console.error("Chat API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
