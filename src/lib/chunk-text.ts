/**
 * Smart document chunking for large text extraction.
 *
 * Splits long documents at paragraph boundaries so each chunk produces
 * a manageable number of records for any LLM output-token ceiling.
 * No overlap between chunks — clean splits to avoid duplicate records.
 *
 * Pure logic — no Node.js or browser APIs — usable in both contexts.
 */

/** Documents shorter than this (in characters) are processed in a single call. */
export const CHUNK_THRESHOLD = 10_000;

/** Target size per chunk. */
export const CHUNK_TARGET = 8_000;

/** Max concurrent chunk LLM calls per document to avoid rate-limit storms. */
export const CHUNK_CONCURRENCY = 3;

/**
 * File size (bytes) above which the upload warning shows.
 * Conservative — a text file at this size is likely above CHUNK_THRESHOLD,
 * while a PDF at this size may not be. We prefer false positives over
 * surprising the user with unexpected chunking.
 */
export const LARGE_FILE_BYTES = 15_000;

export interface TextChunk {
  text: string;
  index: number;
  total: number;
}

/**
 * Split `text` into chunks at paragraph boundaries.
 *
 * Returns a single-element array when the text is below CHUNK_THRESHOLD.
 * Falls back to single-newline splits when no paragraph breaks exist.
 */
export function chunkText(text: string): TextChunk[] {
  if (text.length <= CHUNK_THRESHOLD) {
    return [{ text, index: 0, total: 1 }];
  }

  // Try paragraph boundaries first (double newline)
  let paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());

  // Fallback: single-newline splits for monolithic text (OCR, HTML-to-text)
  if (paragraphs.length <= 1) {
    paragraphs = text.split(/\n/).filter((p) => p.trim());
  }

  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length > 0 && current.length + para.length + 2 > CHUNK_TARGET) {
      chunks.push(current);
      current = para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) {
    chunks.push(current);
  }

  // Last resort: no split points at all — return as single chunk
  if (chunks.length === 0) {
    chunks.push(text);
  }

  return chunks.map((c, i) => ({ text: c, index: i, total: chunks.length }));
}

/**
 * Positional preamble prepended to the user prompt for multi-chunk documents.
 * Returns empty string when total <= 1.
 */
export function chunkPromptPrefix(index: number, total: number, mode: "extract" | "process" = "extract"): string {
  if (total <= 1) return "";
  const section = `[SECTION ${index + 1} OF ${total}]\n`;
  if (mode === "extract") {
    return section + "Extract records ONLY from this section. Do not infer or repeat records from other sections.\n\n";
  }
  return section + "Process only this section. Do not repeat content from other sections.\n\n";
}

/**
 * Whether a file is likely large enough to trigger chunking.
 * Rough heuristic from file size — the actual decision uses character count.
 */
export function isLikelyChunked(fileSize: number): boolean {
  return fileSize > LARGE_FILE_BYTES;
}
