import { describe, it, expect } from "vitest";
import {
  chunkText,
  chunkPromptPrefix,
  isLikelyChunked,
  CHUNK_THRESHOLD,
  CHUNK_TARGET,
  CHUNK_CONCURRENCY,
  LARGE_FILE_BYTES,
} from "../chunk-text";

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const text = "Short document.\n\nParagraph two.";
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].total).toBe(1);
  });

  it("returns a single chunk for text at exactly the threshold", () => {
    const text = "x".repeat(CHUNK_THRESHOLD);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
  });

  it("splits long text into multiple chunks at paragraph boundaries", () => {
    const para = "A".repeat(3000);
    const text = [para, para, para, para, para].join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.total).toBe(chunks.length);
    });
  });

  it("does NOT overlap — chunk N+1 does not start with tail of chunk N", () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) =>
      `Paragraph ${i}: ${"word ".repeat(400)}`
    );
    const text = paragraphs.join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);

    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1].text.slice(-200);
      const currHead = chunks[i].text.slice(0, 200);
      expect(currHead).not.toContain(prevTail);
    }
  });

  it("falls back to single-newline splits for text without paragraph breaks", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i}: ${"data ".repeat(20)}`);
    const text = lines.join("\n"); // single newlines only
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("handles text with no newlines at all as a single chunk", () => {
    const text = "word ".repeat(5000);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
  });

  it("handles empty text", () => {
    const chunks = chunkText("");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("");
  });
});

describe("chunkPromptPrefix", () => {
  it("returns empty string for single-chunk documents", () => {
    expect(chunkPromptPrefix(0, 1)).toBe("");
    expect(chunkPromptPrefix(0, 1, "extract")).toBe("");
    expect(chunkPromptPrefix(0, 1, "process")).toBe("");
  });

  it("returns section header for multi-chunk extract", () => {
    const prefix = chunkPromptPrefix(1, 3, "extract");
    expect(prefix).toContain("[SECTION 2 OF 3]");
    expect(prefix).toContain("Extract records ONLY");
  });

  it("returns section header for multi-chunk process", () => {
    const prefix = chunkPromptPrefix(0, 5, "process");
    expect(prefix).toContain("[SECTION 1 OF 5]");
    expect(prefix).toContain("Process only this section");
  });

  it("defaults to extract mode", () => {
    const prefix = chunkPromptPrefix(2, 4);
    expect(prefix).toContain("[SECTION 3 OF 4]");
    expect(prefix).toContain("Extract records ONLY");
  });
});

describe("isLikelyChunked", () => {
  it("returns false for small files", () => {
    expect(isLikelyChunked(5_000)).toBe(false);
    expect(isLikelyChunked(10_000)).toBe(false);
  });

  it("returns true for large files", () => {
    expect(isLikelyChunked(100_000)).toBe(true);
    expect(isLikelyChunked(500_000)).toBe(true);
  });
});

describe("constants", () => {
  it("CHUNK_THRESHOLD is 10000", () => {
    expect(CHUNK_THRESHOLD).toBe(10_000);
  });

  it("CHUNK_TARGET is 8000", () => {
    expect(CHUNK_TARGET).toBe(8_000);
  });

  it("CHUNK_CONCURRENCY is 3", () => {
    expect(CHUNK_CONCURRENCY).toBe(3);
  });

  it("LARGE_FILE_BYTES is 15000", () => {
    expect(LARGE_FILE_BYTES).toBe(15_000);
  });
});
