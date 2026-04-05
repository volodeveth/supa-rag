interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

const SYSTEM_PROMPT = `You are a helpful assistant for Volodymyr Dorosh's portfolio. You answer questions about his projects, skills, experience, and source code based ONLY on the provided context.

Rules:
1. Answer ONLY using information from the context below
2. If the context doesn't contain the answer, say "I don't have this information in the documents"
3. When showing code, use markdown code blocks with the appropriate language tag
4. Never make assumptions or add information not in the context
5. If partially relevant, clearly state what you know and what you don't
6. Respond in the same language the user asks in (Ukrainian, English, etc.)
7. The context may contain source code from Volodymyr's projects — present it clearly when asked`;

export function buildMessages(
  query: string,
  contextChunks: Array<{ content: string; relevance_score: number; metadata: Record<string, unknown> }>
): Message[] {
  const context = contextChunks
    .map(
      (chunk, i) =>
        `[Chunk ${i + 1}] (relevance: ${chunk.relevance_score.toFixed(3)})\n${chunk.content}`
    )
    .join("\n\n---\n\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Context:\n${context}\n\n---\n\nQuestion: ${query}`,
    },
  ];
}

interface LlmStreamResult {
  stream: ReadableStream;
  getUsage: () => { promptTokens: number; completionTokens: number };
}

export async function generateAnswerStream(messages: Message[]): Promise<LlmStreamResult> {
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat",
        messages,
        temperature: 0.1,
        top_p: 0.9,
        max_tokens: 3000,
        stream: true,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(
      `OpenRouter error: ${err.error?.message ?? response.statusText}`
    );
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let promptTokens = 0;
  let completionTokens = 0;

  const stream = new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n").filter((l) => l.startsWith("data: "));
        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            controller.close();
            return;
          }
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              controller.enqueue(new TextEncoder().encode(content));
            }
            // Capture usage from the final chunk (OpenRouter includes it)
            if (json.usage) {
              promptTokens = json.usage.prompt_tokens ?? 0;
              completionTokens = json.usage.completion_tokens ?? 0;
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    },
  });

  return {
    stream,
    getUsage: () => ({ promptTokens, completionTokens }),
  };
}
