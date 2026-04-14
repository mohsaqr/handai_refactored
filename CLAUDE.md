# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Handai is a qualitative/quantitative data analysis suite powered by LLMs. Built with Next.js 16, React 19, TypeScript (strict), Tailwind CSS v4, and Vercel AI SDK. Ships as a web app, a static export for GitHub Pages, and a Tauri v2 desktop app. Users upload CSV/XLSX files, pick an analysis tool and LLM provider, and run batch processing. Results are stored in SQLite (web), IndexedDB (static/browser-storage), or SQLite via Tauri plugin (desktop) and exportable as CSV.

## Prerequisites

Node.js 20+ and npm 10+.

## Commands

```bash
npm run dev          # Dev server at http://localhost:3000 (uses Webpack, not Turbopack)
npm run build        # Production build (standalone output, 0 TS errors required)
npm start            # Serve production build on port 3000
npm test             # Vitest — run all tests across 4 suites
npm run test:watch   # Vitest in watch mode
npm run lint         # ESLint (flat config, next/core-web-vitals + next/typescript)
npx tsc --noEmit     # TypeScript type-check (strict mode)
```

Run a single test file: `npx vitest run src/lib/__tests__/retry.test.ts`

Run a single test by name: `npx vitest run -t "test name pattern"`

Test files live in `src/lib/__tests__/` (analytics, prompts, retry, validation). Vitest runs in Node.js environment (not jsdom) — see `vitest.config.ts`.

### First-Time Setup

`npm install` runs `postinstall` which triggers Prisma codegen (`prisma generate`). Then `npx prisma migrate dev` creates `prisma/dev.db`. The only env var needed is `DATABASE_URL="file:./dev.db"` (see `.env.example`).

After schema changes: `npx prisma migrate dev --name <description>` to generate and apply a migration. To regenerate the Prisma client without migrating: `npx prisma generate`. To reset the database: `npx prisma migrate reset`.

For web deployments, server-side API key defaults can be set in `.env.local` (e.g., `OPENAI_API_KEY=sk-...`). Keys entered in the Settings UI take precedence.

## Architecture

For exhaustive detail, see `ARCHITECTURE.md`. Below is what you need to get productive quickly.

### LLM Dispatch (two runtime paths)

The same React components work across two runtime contexts, but LLM calls and persistence take different paths:

- **Web (server)**: Browser → `/api/process-row` (Next.js API route) → `src/lib/ai/providers.ts` (`getModel()`) → Provider API. Results logged via Prisma to SQLite.
- **Browser-direct** (static builds, `NEXT_PUBLIC_BROWSER_STORAGE=1`, or Tauri desktop): Browser/WebView → `src/lib/llm-browser.ts` (`getModel()`) → Provider API direct. Results logged via `src/lib/db-indexeddb.ts` (IndexedDB) or `src/lib/db-tauri.ts` (Tauri SQLite). API keys stay in browser; local models work from user's machine.

`src/lib/llm-dispatch.ts` is the unified dispatch layer — tool pages call its functions (e.g., `dispatchProcessRow`, `dispatchCreateRun`, `dispatchSaveResults`) which internally branch on `useBrowserStorage` (`NEXT_PUBLIC_STATIC=1` OR `NEXT_PUBLIC_BROWSER_STORAGE=1`). Use dispatch functions instead of checking runtime context in page code.

### Build Targets

Controlled by env vars in `next.config.ts`:
- `output: "standalone"` (default) — web deployment/Docker
- `output: "export"` (when `STATIC_BUILD=1`) — static HTML for GitHub Pages (adds `basePath` + `assetPrefix` via `PAGES_BASE_PATH`)
- `output: "export"` (when `TAURI_BUILD=1`) — static HTML bundled into Tauri v2 desktop app (`desktop/tauri/`)

The `build:static` script (`bash scripts/build-static.sh`) temporarily moves `src/app/api/` and `src/app/history/[id]/page.tsx` out of the source tree (bash `trap` ensures restore on exit) because `output: "export"` cannot include API routes or dynamic routes.

Tauri desktop uses `@tauri-apps/plugin-sql` for SQLite persistence and a Rust `save_file` command for native OS save dialogs. Runtime detection: `"__TAURI_INTERNALS__" in window`.

### Key Libraries

| Layer | What | Where |
|---|---|---|
| Provider registry | `getModel()` — returns Vercel AI SDK `LanguageModelV3` for any of 10 providers (pure `fetch`, no Node.js APIs — runs in both server and browser) | `src/lib/ai/providers.ts` |
| Unified dispatch | Static/Web branching for LLM calls, run history, and results | `src/lib/llm-dispatch.ts` |
| State | Zustand store persisted to localStorage as `handai-storage` | `src/lib/store.ts` |
| Validation | Zod schemas for all API route request bodies | `src/lib/validation.ts` |
| Retry | `withRetry()` — exponential backoff, fast-fail on auth/400 errors | `src/lib/retry.ts` |
| Prompts | Prompt registry with per-tool localStorage overrides | `src/lib/prompts.ts` |
| Analytics | Cohen's kappa, pairwise agreement calculations | `src/lib/analytics.ts` |
| DB (web) | Prisma 6 + SQLite (`prisma/dev.db`) | `src/lib/prisma.ts` |
| DB (browser) | IndexedDB for static + browser-storage mode | `src/lib/db-indexeddb.ts` |
| DB (desktop) | Tauri SQLite via `@tauri-apps/plugin-sql` | `src/lib/db-tauri.ts` |
| Processing state | Zustand store for cross-navigation batch processing persistence | `src/lib/processing-store.ts` |
| Session restore | Transfers run history payload back to tool pages | `src/lib/restore-store.ts` |
| CSV export | `downloadCSV()` — blob download | `src/lib/export.ts` |
| Types | Shared interfaces (Row, ProviderConfig, RunMeta, etc.) | `src/types/index.ts` |

### API Routes (web only)

All in `src/app/api/`. Each route validates input with Zod schemas from `src/lib/validation.ts`:

- `process-row` — Core single-row LLM dispatch (used by Transform, Qualitative Coder, AI Coder, Codebook Generator, Abstract Screener)
- `consensus-row` — Multi-worker + judge for Consensus Coder
- `comparison-row` — Parallel multi-model dispatch for Model Comparison
- `automator-row` — Multi-step pipeline execution
- `generate-row` — Synthetic data generation
- `ai-agents-row` — Multi-agent negotiation with role-based personas, multi-round refinement, and referee synthesis
- `document-extract` / `document-analyze` / `document-process` — PDF/DOCX processing (web uses Node.js `pdf-parse` + `mammoth`; static uses `pdfjs-dist` WASM + mammoth browser build via `src/lib/document-browser.ts`)
- `local-models` — Probes Ollama (port 11434) + LM Studio (port 1234)
- `runs` / `runs/[id]` / `results` — CRUD for run history

### Database Schema (Prisma)

Schema at `prisma/schema.prisma`. Key models:
- **Run** — runType, provider, model, temperature, maxTokens, systemPrompt, inputFile, inputRows, status, successCount, errorCount, avgLatency, totalDuration, jsonMode, maxConcurrency, autoRetry
- **RunResult** — rowIndex, inputJson, output, status, errorType, errorMessage, latency, retryAttempt
- **ConfiguredProvider** — providerType, displayName, baseUrl, apiKey, defaultModel, isEnabled, temperature, maxTokens, capabilities, totalRequests, totalTokens, lastTested
- Also: `Session`, `LogEntry`, `ProviderSetting`, `SystemPromptOverride`

### Page Structure

Each tool is a page at `src/app/<tool-name>/page.tsx`. Pages are `"use client"` components that use the Zustand store for provider config and `p-limit` for concurrency control (governed by `systemSettings.maxConcurrency`).

12 tool pages: `abstract-screener`, `ai-agents`, `ai-coder`, `automator`, `codebook-generator`, `consensus-coder`, `extract-data`, `generate`, `model-comparison`, `process-documents`, `qualitative-coder`, `transform` — plus `settings` and `history` (with `history/[id]` dynamic route).

### Shared Hooks (`src/hooks/`)

| Hook | Purpose |
|---|---|
| `useBatchProcessor` | Reusable parallel batch LLM processing with progress, abort, resume, stats, and run history logging. Used by most tool pages (7 of 10 tools). |
| `useAIInstructions` | Manages AI instruction text with localStorage persistence. |
| `useColumnSelection` | Manages which CSV columns are selected for processing. |
| `usePersistedPrompt` | Persists a prompt textarea to localStorage with a given key. |
| `useProcessingFlag` | Registers processing status in global store for sidebar indicators. |
| `useRestoreSession` | Consumes session restore payload from history page. |

**Note:** `codebook-generator`, `generate`, and `process-documents` do not yet use `useBatchProcessor` — they have custom processing loops.

### Processing Persistence

Batch processing survives page navigation via a module-level architecture:

- `src/lib/processing-store.ts` — Zustand store holding global processing state (`isProcessing`, `aborting`, `progress`, `results`, `stats`, `runId`). Uses module-level abort flags outside Zustand and generation counters to prevent stale loops from updating superseded runs. Progress updates are batched via `requestAnimationFrame`.
- `src/hooks/useBatchProcessor.ts` — Runs the processing loop at module level (not inside React), so it survives component unmount. An `activeJobs` Map keyed by `toolId` holds strong references to running promises. React only launches and reads state.
- Sidebar shows a pulsing blue dot for tools with active processing (`useProcessingFlag`).

### Shared Tool Components (`src/components/tools/`)

| Component | Purpose |
|---|---|
| `UploadPreview` | CSV/XLSX file upload + data preview table, with optional sample dataset picker |
| `ColumnSelector` | Checkbox grid for selecting which columns to process |
| `ExecutionPanel` | Preview/Test/Full run buttons + progress bar + Resume Failed button |
| `ResultsPanel` | DataTable for batch results + export buttons + run history link |
| `NoModelWarning` | Inline warning when no LLM provider is configured |
| `PromptEditor` | Textarea with prompt persistence and reset-to-default |
| `DataTable` | Sortable/filterable table for displaying Row[] data |
| `FileUploader` | Drag-and-drop file upload zone |
| `AIInstructionsSection` | AI instructions textarea with persistence |
| `SampleDatasetPicker` | Dropdown to load built-in sample datasets for testing |

UI primitives from shadcn/ui in `src/components/ui/`.

### AI Coder Architecture

AI Coder (`src/app/ai-coder/`) is the most complex tool page. Unlike other tools that use batch-only processing, AI Coder has an **interactive row-by-row coding interface** with optional batch processing:

- **page.tsx** — Main page with 6 sections: Upload, Columns, Codebook, AI Instructions, Code Data (interactive), Export Results. Does NOT use `useBatchProcessor` — implements its own inline batch loop.
- **AnalyticsDialog.tsx** — Near-full-screen dialog showing code frequency, AI vs human agreement (precision/recall), and disagreement list. Uses `codingData` (human codes) and `aiData` (AI suggestions) for metrics.
- **ReviewPanel.tsx** — Row-by-row review panel for correcting AI batch results. Exports `CodeEntry` type used across all AI Coder components.

Key state in page.tsx:
- `codingData: Record<number, string[]>` — Human-applied codes per row index
- `aiData: Record<number, AISuggestion>` — AI suggestions per row (codes + confidence + reasoning)
- `codebook: CodeEntry[]` — Code definitions (code, description, highlights)
- `settings: AICSettings` — 6 UI settings (contextRows, autoAdvance, lightMode, horizontalCodes, buttonsAboveText, autoAcceptThreshold)

localStorage keys: `aic_autosave` (session recovery), `aic_settings` (UI settings), `aic_named_sessions` (saved sessions), `handai_codebook_aicoder` (codebook persistence).

Abstract Screener also uses autosave (`as_autosave` key) with the same recovery banner pattern on page load.

6 sample datasets are available in `src/lib/sample-data.ts` (product reviews, healthcare interviews, support tickets, learning experiences, exit interviews, stakeholder feedback) — all tools can use these for testing without requiring file uploads.

### CI/CD

GitHub Pages deployment via `.github/workflows/deploy.yml` on push to `main` or `fix`. Sets `STATIC_BUILD=1`, `NEXT_PUBLIC_STATIC=1`, and `PAGES_BASE_PATH=/handai`. The `build:static` script (`bash scripts/build-static.sh`) handles static export, adding a `.nojekyll` file to `out/` for GitHub Pages compatibility.

### Conventions

- Default system settings: `temperature: 0`, `maxTokens: null`, `maxConcurrency: 5`, `autoRetry: true`
- Dispatch error contract: `dispatchCreateRun`/`dispatchSaveResults` never throw (log + return null/void); `dispatchProcessRow` and other row-level dispatch functions throw on error (caller catches per-row)
- All fetch calls must check `if (!res.ok) throw new Error(...)` before `res.json()`
- Concurrency is controlled globally via `pLimit(systemSettings.maxConcurrency)`, not per-page state
- `@/*` path alias maps to `./src/*`
- API keys are stored in browser localStorage (Zustand persist), never in `.env` for local dev
- Document encoding fallback chain: check UTF-8 BOM → try UTF-8 → fall back to Windows-1252 if replacement chars detected (`document-extract/route.ts`, `document-browser.ts`)
- 10 LLM providers supported: OpenAI, Anthropic, Google, Groq, Together, Azure, OpenRouter, Ollama, LM Studio, Custom — all configured via `src/lib/store.ts`
- Each tool page mirrors its API route in `src/lib/llm-browser.ts` for static builds (e.g., `processRowDirect()` mirrors `/api/process-row`)
- Validate all API route inputs with Zod schemas from `src/lib/validation.ts` — add a new schema there when adding a new route
- When adding a new tool page: create `src/app/<tool-name>/page.tsx` as a `"use client"` component, add its API route in `src/app/api/`, add a matching browser-side function in `src/lib/llm-browser.ts`, and add navigation entry in `src/components/AppSidebar.tsx`
- DB logging is async and non-blocking — a Prisma/SQLite failure must never mask a successful LLM result
- Worker failures are isolated with `Promise.allSettled` (consensus workers, comparison workers) — one failing model must not abort others
- All localStorage reads must happen inside `useEffect(() => {}, [])` to avoid SSR/hydration mismatches
- TypeScript strict mode is enforced — builds must produce 0 TS errors, 0 lint errors
