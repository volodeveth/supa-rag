import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const { traceId, feedback, comment } = await request.json();

    if (!traceId || typeof traceId !== "string") {
      return NextResponse.json({ error: "traceId is required" }, { status: 400 });
    }

    if (!feedback || !["thumbs_up", "thumbs_down"].includes(feedback)) {
      return NextResponse.json(
        { error: "feedback must be 'thumbs_up' or 'thumbs_down'" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from("chat_traces")
      .update({
        feedback,
        feedback_comment: comment?.slice(0, 1000) || null,
      })
      .eq("trace_id", traceId);

    if (error) {
      console.error("Feedback save error:", error);
      return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
