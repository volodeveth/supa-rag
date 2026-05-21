// LLM-as-a-judge for RAG eval. Uses OpenRouter, defaults to a free model
// different from the generator (DeepSeek) to avoid self-bias.

export interface JudgeScores {
  faithfulness: number;
  answer_relevance: number;
  context_relevance: number;
  context_sufficiency: number;
  reasoning: string;
}

export const JUDGE_MODEL =
  process.env.JUDGE_MODEL || "meta-llama/llama-3.3-70b-instruct:free";

const SYSTEM_PROMPT = `You are a strict RAG quality evaluator. You read a user QUERY, the retrieved CONTEXT chunks, and the model's ANSWER, and you score four aspects on a 0.0-1.0 scale.

Definitions:
- faithfulness: Are the ANSWER's factual claims supported by CONTEXT? 1.0 = fully grounded; 0.0 = hallucinated facts not present in CONTEXT. A refusal ("I don't have this information") that does not invent facts is faithful (1.0).
- answer_relevance: Does the ANSWER address what was asked? 1.0 = directly answers QUERY; 0.0 = off-topic or evasive.
- context_relevance: Are the CONTEXT chunks topically relevant to QUERY? 1.0 = all chunks are on-topic; 0.0 = chunks are irrelevant.
- context_sufficiency: Does CONTEXT contain enough information for a full answer? 1.0 = sufficient; 0.0 = key information missing. A correct refusal driven by insufficient context implies low context_sufficiency.

Output: Return ONLY a single JSON object with these exact keys and no markdown wrappers:
{"faithfulness":0.9,"answer_relevance":0.9,"context_relevance":0.9,"context_sufficiency":0.9,"reasoning":"one or two sentences"}

Scores must be numbers between 0 and 1 inclusive. The reasoning must be at most two sentences in English.`;

interface JudgeInput {
  query: string;
  answer: string;
  sources: Array<{ content: string; relevance?: number }>;
}

function buildUserPrompt(input: JudgeInput): string {
  const contextStr = input.sources
    .map(
      (s, i) =>
        `[Chunk ${i + 1}${s.relevance != null ? ` rel=${s.relevance.toFixed(3)}` : ""}]\n${s.content}`
    )
    .join("\n\n---\n\n");

  return `QUERY:\n${input.query}\n\nCONTEXT:\n${contextStr}\n\nANSWER:\n${input.answer}`;
}

function clamp01(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function extractJson(text: string): JudgeScores | null {
  // Strip fenced code blocks if the model added them despite instructions.
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  // Try to find the first { ... } block.
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return {
      faithfulness: clamp01(parsed.faithfulness),
      answer_relevance: clamp01(parsed.answer_relevance),
      context_relevance: clamp01(parsed.context_relevance),
      context_sufficiency: clamp01(parsed.context_sufficiency),
      reasoning:
        typeof parsed.reasoning === "string"
          ? parsed.reasoning.slice(0, 600)
          : "",
    };
  } catch {
    return null;
  }
}

export async function judgeTrace(input: JudgeInput): Promise<JudgeScores | null> {
  const userPrompt = buildUserPrompt(input);

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.0,
        max_tokens: 400,
        // Models that support JSON mode honor this; others ignore it.
        response_format: { type: "json_object" },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Judge API ${response.status}: ${text.slice(0, 300) || response.statusText}`
    );
  }

  const json = await response.json();
  const content: string | undefined = json.choices?.[0]?.message?.content;
  if (!content) return null;

  return extractJson(content);
}
