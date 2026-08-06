// LLM-as-a-judge for RAG eval. Uses OpenRouter, defaults to a free model
// different from the generator (DeepSeek) to avoid self-bias.

export interface JudgeScores {
  faithfulness: number;
  answer_relevance: number;
  context_relevance: number;
  context_sufficiency: number;
  reasoning: string;
}

// Fallback chain. Tried in order; we move to the next model on transport errors
// (404 for retired slugs, 429 rate limits, 5xx) and on unusable output.
// All of these are non-reasoning instruct models — reasoning models spend the
// token budget on a `reasoning` field and return `content: null`.
// None of them is DeepSeek: the judge must differ from the generator to avoid self-bias.
const DEFAULT_JUDGE_MODELS = [
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-26b-a4b-it",
  "qwen/qwen3-30b-a3b-instruct-2507",
];

// JUDGE_MODEL env var pins a single model; JUDGE_MODELS overrides the whole chain.
export const JUDGE_MODELS: string[] = process.env.JUDGE_MODELS
  ? process.env.JUDGE_MODELS.split(",").map((s) => s.trim()).filter(Boolean)
  : process.env.JUDGE_MODEL
    ? [process.env.JUDGE_MODEL]
    : DEFAULT_JUDGE_MODELS;

// Label for reporting when no single model has answered yet.
export const JUDGE_MODEL = JUDGE_MODELS.join(" → ");

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

async function callJudgeModel(
  model: string,
  userPrompt: string
): Promise<JudgeScores> {
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.0,
        // Generous budget: a reasoning model that slips into the chain would
        // otherwise burn the whole allowance before emitting any content.
        max_tokens: 800,
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
  if (json.error) {
    // OpenRouter can return a 200 with an error body (upstream provider failures).
    throw new Error(
      `Judge upstream error: ${JSON.stringify(json.error).slice(0, 300)}`
    );
  }

  const message = json.choices?.[0]?.message;
  // Reasoning models put everything in `reasoning` and leave `content` null.
  const raw: string | undefined = message?.content || message?.reasoning;
  if (!raw) {
    const finish = json.choices?.[0]?.finish_reason ?? "unknown";
    throw new Error(`Judge returned empty content (finish_reason: ${finish})`);
  }

  const scores = extractJson(raw);
  if (!scores) {
    throw new Error(`Judge returned unparseable output: ${raw.slice(0, 200)}`);
  }
  return scores;
}

export interface JudgeResult extends JudgeScores {
  /** Model that actually produced the scores — may not be the first in the chain. */
  model: string;
}

/**
 * Scores one trace, walking the model chain until one succeeds.
 * Throws with every attempt's error only when the whole chain fails.
 */
export async function judgeTrace(input: JudgeInput): Promise<JudgeResult> {
  const userPrompt = buildUserPrompt(input);
  const failures: string[] = [];

  for (const model of JUDGE_MODELS) {
    try {
      const scores = await callJudgeModel(model, userPrompt);
      return { ...scores, model };
    } catch (err) {
      failures.push(
        `${model}: ${err instanceof Error ? err.message : "unknown"}`
      );
    }
  }

  throw new Error(`All judge models failed — ${failures.join(" | ")}`);
}
