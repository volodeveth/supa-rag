// Detects when the model returned a stock "I don't know" answer.
// The system prompt instructs the LLM to reply with
// "I don't have this information in the documents" when context is insufficient,
// and the chat route falls back to the same phrase when retrieval is empty.
// We also catch common paraphrases in EN and UK because the model
// is instructed to respond in the user's language.

const PATTERNS: RegExp[] = [
  /\bi\s+don'?t\s+have\s+(this|that|the|relevant|enough)?\s*information\b/i,
  /\bi\s+do\s+not\s+have\s+(this|that|the|relevant|enough)?\s*information\b/i,
  /\bno\s+(relevant|enough)?\s*information\s+(in|about)\b/i,
  /\b(i\s+)?cannot\s+answer\b/i,
  /\b(i\s+am|i'?m)\s+unable\s+to\s+answer\b/i,
  /\bnot\s+(enough|sufficient)\s+(context|information)\b/i,
  // Ukrainian
  /(в мене|у мене)\s+нема(є)?\s+(цієї|цьогo|такої)?\s*інформац/i,
  /не\s+маю\s+(цієї|такої)?\s*інформац/i,
  /немає\s+інформації\s+в\s+документ/i,
  /в\s+документах\s+немає/i,
];

export function isNoAnswer(answer: string | null | undefined): boolean {
  if (!answer) return true;
  const trimmed = answer.trim();
  if (trimmed.length === 0) return true;
  // Only check first ~400 chars — refusals are typically near the start.
  const head = trimmed.slice(0, 400);
  return PATTERNS.some((p) => p.test(head));
}
