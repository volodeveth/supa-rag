// Pipeline provenance recorded on every trace.
//
// The point: when a quality metric moves, we need to know whether *we* moved it.
// Model names are read from the modules that actually make the calls, so they
// cannot drift. The prompt version is a fingerprint of the prompt text itself —
// edit the prompt and the version changes on its own, with nothing to remember.

import { GENERATOR_MODEL, SYSTEM_PROMPT } from "./llm";
import { EMBEDDING_MODEL } from "./embeddings";
import { RERANKER_MODEL } from "./reranker";

/** FNV-1a, 32-bit. Not cryptographic — this is a change detector, not a digest. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // hash *= 16777619, kept in 32-bit range without BigInt
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export const PROMPT_VERSION = fingerprint(SYSTEM_PROMPT);

export const PIPELINE_VERSIONS = {
  generatorModel: GENERATOR_MODEL,
  embeddingModel: EMBEDDING_MODEL,
  rerankerModel: RERANKER_MODEL,
  promptVersion: PROMPT_VERSION,
} as const;
