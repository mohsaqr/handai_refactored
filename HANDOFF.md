# Session Handoff — 2026-04-14

## Completed

### Smart Document Chunking for Extract Data + Process Documents
- Large documents (>10K chars) are automatically split at paragraph boundaries (~8K per chunk)
- Chunks processed in parallel with `pLimit(3)` concurrency to avoid rate-limit storms
- No overlap between chunks — clean splits, zero duplicate records
- Chunk-aware prompts: `[SECTION 2 OF 5] Extract records ONLY from this section...`
- Falls back to single-newline splits when no paragraph breaks exist (OCR, HTML-to-text)
- `maxOutputTokens` only sent when user has configured it in Settings (no hardcoded default)

### Chunk Failure Handling
- Failed chunks logged with `console.error` (chunk index, document name, error reason)
- `failedChunks` count returned in API response alongside `chunks` total
- Process Documents inserts `[Section N of M: processing failed]` placeholder for gaps
- Both routes return 422 when all chunks fail (was silently returning 200 OK with empty results)

### 3-Level User Communication
- **On upload**: Amber "Multi-section" badge on large files in the file list
- **During processing**: Toast "Processed report.pdf in 4 sections (1 failed)" when chunking occurs
- **After processing**: Results subtitle "95 records from 3 file(s) (7 sections)"
- Amber warning banner above Execute section when large files are present

### Prompt Improvements
- Added completeness rules 7-8 to extraction prompt: "Extract EVERY matching record... never truncate, summarize, or omit"
- Both API route and browser-direct mirror have identical prompt text

### Test Updates
- New `src/lib/__tests__/chunk-text.test.ts` — 17 tests (no overlap, paragraph boundaries, single-newline fallback, prompt prefix, isLikelyChunked, constants)
- Updated `src/lib/__tests__/prompts.test.ts` — prompt count 21→29, generate 5→6 (upstream stale)

## Current State
- TS: 0 errors | Lint: 0 warnings | Tests: 131/131 pass
- New files: `src/lib/chunk-text.ts`, `src/lib/__tests__/chunk-text.test.ts`
- Modified: `document-extract/route.ts`, `document-process/route.ts`, `llm-browser.ts`, `llm-dispatch.ts`, `extract-data/page.tsx`, `process-documents/page.tsx`, `prompts.test.ts`

## Key Decisions
- **No overlap**: Overlap caused duplicate records — worse than missing a boundary record. Clean paragraph splits are safer.
- **pLimit(3) per document**: Balances parallelism vs rate limits. The batch processor already limits file-level concurrency (default 5), so 5 files × 3 chunks = 15 max concurrent LLM calls.
- **No hardcoded maxOutputTokens**: Removed the 16384 default. Each provider has its own ceiling; chunking is the primary strategy for long output, not a higher token limit.
- **isLikelyChunked instead of estimateChunks**: The bytes-to-chars ratio varies wildly by file type (text ~1.0, PDF ~0.1). Showing "~4 sections" was misleading. "Multi-section" is honest.
- **Section separator `---` for process-documents**: Marks where one chunk's analysis ends and the next begins. Failed chunks get `[Section N: processing failed]` placeholder.

## Open Issues
- Pre-existing code duplication: `extractText()` copied across 3 API routes, `parseCsvResponse`/`tryParseJson` duplicated between route and browser mirror, markdown fence stripping regex repeated 14+ times. Not addressed — out of scope for this change.
- `withRetry` has no jitter — concurrent retries from multiple chunks can collide at the same backoff intervals
- 3 tools still not on `useBatchProcessor` (codebook-generator, generate, process-documents)

## Next Steps
- Extract shared `extractText()` server function to `src/lib/extract-text-server.ts`
- Extract shared `stripCodeFences()` helper to `src/lib/`
- Add jitter to `withRetry` backoff
- Consider moving extraction prompts into `src/lib/prompts.ts` registry
