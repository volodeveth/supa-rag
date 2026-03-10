export interface Chunk {
  content: string;
  metadata: {
    source: string;
    chunkIndex: number;
    totalChunks?: number;
  };
}

const CHUNK_SIZE = 2000; // ~512 tokens
const CHUNK_OVERLAP = 400; // ~100 tokens (20%)

/**
 * Recursively split text: paragraphs -> sentences -> characters.
 * Preserves logical boundaries where possible.
 */
export function chunkText(text: string, source: string): Chunk[] {
  // Normalize whitespace
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  if (cleaned.length <= CHUNK_SIZE) {
    return [
      {
        content: cleaned,
        metadata: { source, chunkIndex: 0, totalChunks: 1 },
      },
    ];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < cleaned.length) {
    let end = start + CHUNK_SIZE;

    if (end < cleaned.length) {
      // Try to break at paragraph boundary
      const paragraphBreak = cleaned.lastIndexOf("\n\n", end);
      if (paragraphBreak > start + CHUNK_SIZE * 0.5) {
        end = paragraphBreak;
      } else {
        // Try sentence boundary
        const sentenceBreak = cleaned.lastIndexOf(". ", end);
        if (sentenceBreak > start + CHUNK_SIZE * 0.5) {
          end = sentenceBreak + 1;
        }
      }
    } else {
      end = cleaned.length;
    }

    chunks.push(cleaned.slice(start, end).trim());
    start = end - CHUNK_OVERLAP;

    if (start < 0) start = 0;
    // Prevent infinite loop if overlap pushes start back too far
    if (chunks.length > 1 && start <= end - CHUNK_SIZE) {
      start = end;
    }
  }

  // Deduplicate: if last chunk is very similar to previous, merge
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    if (last.length < CHUNK_OVERLAP) {
      chunks[chunks.length - 2] += " " + last;
      chunks.pop();
    }
  }

  return chunks.map((content, i) => ({
    content,
    metadata: {
      source,
      chunkIndex: i,
      totalChunks: chunks.length,
    },
  }));
}
