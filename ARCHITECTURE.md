# Handai Web App — Architecture

> **Last updated:** 2026-02-23 (rev 4)
> **Stack:** Next.js 16 · React 19 · TypeScript strict · Tailwind v4 · Vercel AI SDK · Tauri v2

---

## Table of Contents

1. [System Topology](#1-system-topology)
2. [Deployment Models](#2-deployment-models)
3. [Directory Structure](#3-directory-structure)
4. [Core Libraries](#4-core-libraries)
5. [Dual LLM Call Path](#5-dual-llm-call-path)
6. [State Management](#6-state-management)
7. [LLM Providers](#7-llm-providers)
8. [Tools and Pages](#8-tools-and-pages)
9. [API Routes (Web Deployment)](#9-api-routes-web-deployment)
10. [Database Layer](#10-database-layer)
11. [Prompt System](#11-prompt-system)
12. [Tauri Desktop App](#12-tauri-desktop-app)
13. [Build System](#13-build-system)
14. [Testing](#14-testing)
15. [Stability Properties](#15-stability-properties)
16. [Key Design Decisions](#16-key-design-decisions)
17. [Architecture Layers — Summary](#17-architecture-layers--summary)

---

## 1. System Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│  USER                                                               │
│                                                                     │
│  Web browser              Tauri desktop app (macOS/Windows/Linux)   │
│  (any OS)                 ~10 MB, instant launch, no Node.js        │
└────────┬──────────────────────────────┬────────────────────────────┘
         │ HTTP                          │ file:// / tauri://localhost
         ▼                              ▼
┌─────────────────┐          ┌──────────────────────┐
│  Next.js server │          │  WKWebView / WebView2 │
│  (standalone)   │          │  (static HTML/CSS/JS) │
│                 │          │                       │
│  App Router     │          │  App Router (CSR)     │
│  pages          │          │  pages (identical)    │
│                 │          │                       │
│  /api/* routes  │          │  llm-browser.ts       │  ← browser-side
└────────┬────────┘          └──────────┬────────────┘     LLM calls
         │                              │
         │ Prisma (ORM)                 │ @tauri-apps/plugin-sql
         ▼                              ▼
┌────────────────┐          ┌───────────────────────┐
│ SQLite         │          │ SQLite (handai.db)     │
│ (prisma/dev.db)│          │ ~/Library/App Support/ │
│ web deployment │          │ me.saqr.handai/        │
└────────────────┘          └───────────────────────┘
         │                              │
         ▼                              ▼
┌──────────────────────────────────────────────────────┐
│              LLM Provider APIs                       │
│  OpenAI · Anthropic · Google · Groq · Together ·     │
│  Azure · OpenRouter · Ollama · LM Studio · Custom    │
└──────────────────────────────────────────────────────┘
```

---

## 2. Deployment Models

Handai ships as a single codebase that targets two runtime environments with zero application code changes between them. The deployment target is selected at build time via the `TAURI_BUILD=1` environment variable.

| Aspect | Web Deployment | Tauri Desktop |
|---|---|---|
| Build output | `.next/standalone/server.js` | `out/` (static HTML/CSS/JS) |
| Next.js output mode | `standalone` | `export` |
| LLM calls | Server → `/api/*` routes → providers | Browser (WebView) → providers directly |
| Database | Prisma 6 + SQLite (`prisma/dev.db`) | `@tauri-apps/plugin-sql` + SQLite (`handai.db`) |
| Document parsing | Node.js `pdf-parse` + `mammoth` CommonJS | `pdfjs-dist` WASM + mammoth browser build |
| Local model detection | `/api/local-models` (server-side, no CORS) | Direct browser fetch (no CORS in desktop WebView) |
| CSV export | Blob URL + anchor click | Native OS save dialog via `save_file` Tauri command |
| Runtime detection | `isTauri = false` | `"__TAURI_INTERNALS__" in window` |
| Bundle size | ~250 MB Docker / hosted | ~10 MB (uses system WebView) |
| API keys | Managed by server env or user settings | Stored in user's localStorage, used directly |
| History DB | Accessible via `/history/[id]` route | Inline view at `/history?id=uuid` |

Both deployments share 100% of the application page components, the Zustand store, `getModel()`, `withRetry()`, `analytics.ts`, `prompts.ts`, and `export.ts`. There is no forked code in the pages — only runtime branches.

---

## 3. Directory Structure

```
web/
├── src/
│   ├── app/                           ← Next.js App Router
│   │   ├── api/                       ← 10 API routes (web deployment only)
│   │   │   ├── process-row/           ← Single LLM call + optional DB log
│   │   │   ├── generate-row/          ← Synthetic CSV generation
│   │   │   ├── comparison-row/        ← N models, same prompt, parallel
│   │   │   ├── consensus-row/         ← Workers + judge + inter-rater stats
│   │   │   ├── automator-row/         ← K-step sequential LLM pipeline
│   │   │   ├── document-extract/      ← PDF/DOCX → text → LLM → JSON
│   │   │   ├── local-models/          ← Probe Ollama/LM Studio (server-side)
│   │   │   ├── runs/                  ← Create / list run records
│   │   │   ├── runs/[id]/             ← Fetch / delete single run
│   │   │   └── results/               ← Batch-save run results (transaction)
│   │   │
│   │   ├── ai-coder/                  ← AI-assisted qualitative coding
│   │   ├── automator/                 ← Multi-step LLM pipeline builder
│   │   ├── codebook-generator/        ← LLM codebook creation (3-stage)
│   │   ├── consensus-coder/           ← Multi-model consensus coding
│   │   ├── generate/                  ← Synthetic dataset generation
│   │   ├── history/                   ← Run history list + detail
│   │   │   └── [id]/                  ← Dynamic detail page (web only)
│   │   │       ├── page.tsx           ← Thin server wrapper (excluded from Tauri build)
│   │   │       └── RunDetailClient.tsx ← Client component shared with history/page.tsx
│   │   ├── manual-coder/              ← Human qualitative coding interface
│   │   ├── model-comparison/          ← Side-by-side model comparison
│   │   ├── process-documents/         ← PDF/DOCX structured data extraction
│   │   ├── qualitative-coder/         ← Batch LLM coding with codebook
│   │   ├── settings/                  ← Provider config + prompt editor
│   │   ├── transform/                 ← CSV row transformation via LLM
│   │   ├── globals.css
│   │   ├── layout.tsx                 ← Root layout: AppSidebar + main area
│   │   └── page.tsx                   ← Landing page (redirects to transform)
│   │
│   ├── components/
│   │   ├── ui/                        ← shadcn/ui component library
│   │   ├── tools/                     ← Shared tool components
│   │   │   ├── FileUploader.tsx       ← CSV/Excel/JSON drag-drop upload
│   │   │   ├── DataTable.tsx          ← Results table with row expand
│   │   │   ├── ColumnSelector.tsx     ← Multi-column picker
│   │   │   ├── ProgressBar.tsx        ← Batch processing progress
│   │   │   └── ModelSelector.tsx      ← Provider + model combo picker
│   │   └── AppSidebar.tsx             ← Navigation + active model chip + local detection
│   │
│   ├── lib/
│   │   ├── ai/
│   │   │   └── providers.ts           ← getModel() factory (pure fetch, runs anywhere)
│   │   ├── analytics.ts               ← cohenKappa(), pairwiseAgreement(), interpretKappa()
│   │   ├── db-tauri.ts                ← @tauri-apps/plugin-sql wrappers (Tauri path)
│   │   ├── document-browser.ts        ← pdfjs-dist + mammoth browser extraction (Tauri path)
│   │   ├── export.ts                  ← downloadCSV() — blob or Tauri native dialog
│   │   ├── hooks.ts                   ← useActiveModel() hook
│   │   ├── llm-browser.ts             ← Browser-direct LLM functions (Tauri path)
│   │   ├── prisma.ts                  ← Prisma singleton (hot-reload safe)
│   │   ├── prompts.ts                 ← Prompt registry + localStorage override
│   │   ├── retry.ts                   ← withRetry() — exponential backoff, non-retryable detection
│   │   ├── sample-data.ts             ← 6 seeded sample datasets
│   │   ├── store.ts                   ← Zustand store (provider config, localStorage)
│   │   └── validation.ts              ← Zod schemas for all 10 API routes
│   │
│   └── types/
│       └── index.ts                   ← Shared types: ProviderConfig, RunMeta, AgreementMatrix
│
├── prisma/
│   ├── schema.prisma                  ← SQLite schema (Session, Run, RunResult)
│   └── dev.db                         ← Development database (gitignored)
│
├── desktop/
│   └── tauri/                         ← Tauri v2 desktop wrapper
│       ├── src-tauri/
│       │   ├── src/main.rs            ← Rust entry: plugins + SQLite migrations + save_file
│       │   ├── Cargo.toml             ← tauri-plugin-sql, window-state, dialog
│       │   ├── tauri.conf.json        ← Window config, build commands, frontendDist
│       │   └── capabilities/
│       │       └── default.json       ← Plugin permissions (sql:*, dialog:*)
│       └── package.json               ← @tauri-apps/cli dev dependency
│
├── next.config.ts                     ← Dual output mode (standalone / export)
├── package.json                       ← Scripts incl. build:tauri
├── tailwind.config.ts
├── tsconfig.json
└── vitest.config.ts
```

---

## 4. Core Libraries

### `src/lib/ai/providers.ts` — Model factory

The single entry point for creating an AI SDK `LanguageModelV3` for any supported provider.

```typescript
export function getModel(
  provider: string,
  modelId: string,
  apiKey: string,
  baseUrl?: string
): LanguageModelV3
```

**Design contract**: uses only standard `fetch` — no Node.js APIs, no filesystem access. Runs identically in a Next.js API route handler (Node.js) and in a browser WebView (Tauri). This property is what makes the dual call path possible without code duplication.

Provider routing:
- `openai` → `@ai-sdk/openai` with configurable `baseURL` (supports proxies)
- `anthropic` → `@ai-sdk/anthropic`
- `google` → `@ai-sdk/google`
- `groq` → `@ai-sdk/groq`
- `together` → `@ai-sdk/openai` compat at `https://api.together.xyz/v1`
- `openrouter` → `@ai-sdk/openai` compat at `https://openrouter.ai/api/v1` + custom headers
- `azure` → `@ai-sdk/azure` (resource name via `baseUrl` parameter)
- `ollama` → `@ai-sdk/openai` compat at `http://localhost:11434/v1`
- `lmstudio` → `@ai-sdk/openai` compat at `http://localhost:1234/v1`
- `custom` → `@ai-sdk/openai` compat at user-supplied `baseUrl`

---

### `src/lib/retry.ts` — Retry with exponential backoff

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number } = {}
): Promise<T>
```

Default: 3 attempts, 100 ms base delay. Delay doubles each attempt: 100 ms → 200 ms → 400 ms.

Non-retryable errors are detected by matching the error message against a fixed token list:

```
"401", "403", "invalid_api_key", "invalid api key",
"authentication", "authorization", "bad request", "400", "invalid request"
```

Auth errors and bad-request errors throw immediately — no wasted retries, faster user feedback.

---

### `src/lib/analytics.ts` — Inter-rater reliability

| Function | Description |
|---|---|
| `cohenKappa(a, b)` | Cohen's Kappa for two string arrays. Returns `NaN` for degenerate cases (only one category observed). |
| `pairwiseAgreement(outputs)` | N×N agreement matrix for N annotators. Returns labels, per-pair kappa values, and the full matrix. |
| `exactMatchRate(a, b)` | Proportion of positions where two annotators agree exactly. |
| `interpretKappa(k)` | Human-readable label per Landis & Koch (1977): Poor / Slight / Fair / Moderate / Substantial / Almost Perfect. |

Used by both `consensusRowDirect` (Tauri) and `/api/consensus-row` (web). Pure JS — no dependencies.

---

### `src/lib/llm-browser.ts` — Browser-direct LLM functions (Tauri path)

Six functions that mirror the six LLM API routes. Pages detect `isTauri` and call these instead of `fetch('/api/...')`. All dependencies (`getModel`, `withRetry`, `cohenKappa`, `pairwiseAgreement`, `getPrompt`) are pure fetch / pure JS — no Node.js APIs.

| Function | Mirrors API route | Key behaviour |
|---|---|---|
| `processRowDirect` | `/api/process-row` | Single LLM call; `{ output, latency }` |
| `generateRowDirect` | `/api/generate-row` | Schema-based or freeform CSV; parses result with CSV parser; `{ rows, rawCsv, count }` |
| `comparisonRowDirect` | `/api/comparison-row` | N models in parallel via `Promise.all`; individual failures captured as error strings |
| `consensusRowDirect` | `/api/consensus-row` | Full consensus pipeline (workers → kappa → judge → optional quality scores → optional disagreement analysis); `Promise.allSettled` for workers |
| `automatorRowDirect` | `/api/automator-row` | K steps sequentially; each step's JSON output is merged into a cumulative context object for the next step |
| `documentExtractDirect` | `/api/document-extract` | Lazy-imports `document-browser.ts`; extracts text then calls LLM; `{ records, fileName, charCount, count }` |

---

### `src/lib/document-browser.ts` — Browser-side document parsing

```typescript
export async function extractTextBrowser(file: File): Promise<string>
```

| Extension | Library | Notes |
|---|---|---|
| `.pdf` | `pdfjs-dist` (WASM) | Worker URL configured via `import.meta.url`; webpack copies worker to static output |
| `.docx` | `mammoth` (browser build) | Uses `{ arrayBuffer }` API; lazy-imported |
| `.txt`, `.md` | `file.text()` | Native Web API |
| Other | `file.text()` | Fallback |

---

### `src/lib/export.ts` — CSV download

```typescript
export async function downloadCSV(rows: Record<string, unknown>[], filename: string): Promise<void>
```

Writes UTF-8 BOM (`\uFEFF`) for Excel compatibility. All cell values are double-quote escaped.

- **Browser**: builds a Blob URL and triggers an `<a download>` click
- **Tauri**: `"__TAURI_INTERNALS__" in window` → invokes `save_file` Rust command → `blocking_save_file()` → OS native save dialog

WKWebView (macOS WebView) ignores the HTML `download` attribute — the Tauri branch is required.

---

### `src/lib/db-tauri.ts` — Tauri SQLite access

Thin TypeScript wrappers over `@tauri-apps/plugin-sql`. Response shapes match the Prisma-backed API routes exactly so pages need no extra branching for data shape.

| Function | SQL |
|---|---|
| `createRun(params)` | INSERT session if needed + INSERT run; returns `{ id }` |
| `listRuns(limit, offset)` | SELECT runs + result count subquery, ORDER BY `startedAt DESC` |
| `getRun(id)` | SELECT run + all `run_results` for that run |
| `deleteRun(id)` | DELETE `run_results` then DELETE run (plugin-sql has no cascade) |
| `saveResults(runId, results)` | Batch INSERT `run_results`; UPDATE run with completion stats |

Connection is lazily opened and cached in module scope (`_db`).

---

### `src/lib/prompts.ts` — Prompt registry

15 built-in prompts across 6 categories. Each prompt has an `id`, `name`, `category`, and `defaultValue`.

| Category | Prompts |
|---|---|
| `transform` | `transform.default` |
| `qualitative` | `qualitative.default`, `qualitative.rigorous` |
| `consensus` | `consensus.worker_default`, `consensus.worker_rigorous`, `consensus.judge_default`, `consensus.judge_enhanced` |
| `codebook` | `codebook.discovery`, `codebook.consolidation`, `codebook.definition` |
| `generate` | `generate.column_suggestions`, `generate.csv_with_cols`, `generate.csv_freeform` |
| `automator` | `automator.rules` |
| `ai_coder` | `ai_coder.suggestions` |

**Override system**: `getPrompt(id)` checks `localStorage.getItem("handai_prompt_override:" + id)` first. If set, the override is used; otherwise, the built-in `defaultValue` is returned. The Settings page surfaces all 15 prompts in collapsible sections with a reset-to-default option.

`getPrompt()` is safe to call server-side — `localStorage` access is guarded by `typeof window !== 'undefined'`.

---

### `src/lib/store.ts` — Zustand store

```typescript
useAppStore: {
  providers: Record<string, ProviderConfig>  // persisted to localStorage 'handai-storage'
  setProviderKey(providerId, apiKey): void
  setProviderConfig(providerId, config): void
}
```

`persist` middleware merges saved state with `DEFAULT_PROVIDERS` on load, so new providers added in future releases always appear for existing users without data migration.

Default model for each provider:

| Provider | Default model |
|---|---|
| OpenAI | `gpt-4o` |
| Anthropic | `claude-3-5-sonnet-20241022` |
| Google | `gemini-1.5-pro` |
| Groq | `llama-3.3-70b-versatile` |
| Together | `meta-llama/Llama-3-70b-chat-hf` |
| OpenRouter | `anthropic/claude-3.5-sonnet` |
| Ollama | `gpt-oss:latest` (overwritten on detection) |
| LM Studio | `local-model` (overwritten on detection) |

---

### `src/lib/hooks.ts` — Active model hook

```typescript
export function useActiveModel(): ProviderConfig | null
```

Returns the first provider where `isEnabled && (isLocal || apiKey !== "")`. Used by AppSidebar to display the current active model chip and by tools that auto-populate provider/model fields.

---

## 5. Dual LLM Call Path

Every tool page performs runtime detection once at component mount:

```typescript
const [isTauri, setIsTauri] = useState(false);
useEffect(() => {
  setIsTauri(typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);
}, []);
```

The `useEffect` pattern (rather than module-level const) prevents SSR hydration mismatches when `isTauri` affects rendered JSX. For logic-only branching (inside event handlers), a module-level check is acceptable.

### Web path

```
Page → fetch('/api/process-row', body)
     → Next.js API route
     → ProcessRowSchema.safeParse(body)   ← Zod validation
     → getModel(provider, model, apiKey, baseUrl)
     → withRetry(() => generateText({ model, system, prompt, temperature }))
         → Vercel AI SDK → provider HTTPS endpoint
     → [optional] prisma.runResult.create()  ← isolated try/catch
     → Response: { output, latency }
```

### Tauri path

```
Page → processRowDirect(params)           ← llm-browser.ts
     → getModel(provider, model, apiKey, baseUrl)
     → withRetry(() => generateText({ model, system, prompt, temperature }))
         → Vercel AI SDK → provider HTTPS endpoint (direct from WebView)
     → [optional] createRun() + saveResults()  ← db-tauri.ts → plugin-sql → SQLite
     → { output, latency }
```

**No behavioral divergence**: `getModel()` and `withRetry()` are called identically in both paths. The only difference is transport (server fetch vs. browser fetch) and persistence layer (Prisma vs. plugin-sql).

---

## 6. State Management

### Zustand (provider configuration)

Provider config (API keys, enabled state, model selection, base URLs) lives in Zustand, persisted to `localStorage['handai-storage']`. All tool pages read from the store to pre-populate provider/model inputs.

### Per-tool localStorage

| Key | Used by | Content |
|---|---|---|
| `handai_prompt_override:{id}` | All tools | Overridden prompt values |
| `handai_codebook_qualcoder` | Qualitative Coder | Codebook text |
| `handai_steps_automator` | Automator | Pipeline step definitions |
| `aic_autosave` | AI Coder | Current session state |
| `aic_autosave_prev` | AI Coder | Previous session (one-level undo) |
| `mc_autosave` | Manual Coder | Current session state |
| `mc_autosave_prev` | Manual Coder | Previous session (one-level undo) |

### Autosave system (AI Coder + Manual Coder)

Both coders use a dual-slot rotation to prevent data loss:

```
On every state change:
  1. Write current state → AUTOSAVE_KEY
  2. Copy previous AUTOSAVE_KEY → AUTOSAVE_PREV_KEY   (one level of undo)

On beforeunload:
  → Final sync write via stateRef (avoids stale closure)

On mount:
  → Try AUTOSAVE_KEY, fallback to AUTOSAVE_PREV_KEY
  → If data found: restore + show amber "Session recovered" banner
  → Banner has dismiss button; cleared when fresh data loads

Loading new data when codedCount > 0:
  → Intercept via pendingLoad state
  → Show confirmation dialog: "Replace current session?" / Cancel / Load anyway
```

### localStorage hydration rule

All `localStorage` reads happen in `useEffect`, never in render or `useState` lazy initializer. This prevents SSR hydration mismatches when the server-rendered HTML disagrees with client state.

---

## 7. LLM Providers

| Provider | SDK package | Notes |
|---|---|---|
| OpenAI | `@ai-sdk/openai` | Base URL configurable for proxies |
| Anthropic | `@ai-sdk/anthropic` | — |
| Google Gemini | `@ai-sdk/google` | — |
| Groq | `@ai-sdk/groq` | — |
| Together AI | `@ai-sdk/openai` compat | Default base URL: `https://api.together.xyz/v1` |
| Azure OpenAI | `@ai-sdk/azure` | `baseUrl` field holds Azure resource name |
| OpenRouter | `@ai-sdk/openai` compat | Sends `HTTP-Referer` + `X-Title` headers |
| Ollama | `@ai-sdk/openai` compat | Default: `http://localhost:11434/v1` |
| LM Studio | `@ai-sdk/openai` compat | Default: `http://localhost:1234/v1` |
| Custom | `@ai-sdk/openai` compat | User supplies base URL |

### Local model auto-detection

On AppSidebar mount, Handai probes local servers and updates the store:

| Deployment | Mechanism |
|---|---|
| Web | `GET /api/local-models` — server-side probe, avoids CORS |
| Tauri | Direct browser `fetch` to `localhost:11434/api/tags` and `localhost:1234/v1/models` — no CORS in desktop WebView |

If models are found, the provider is auto-enabled and its `defaultModel` updated to the first detected model. A `toast.success` notification is shown.

---

## 8. Tools and Pages

### Transform (`/transform`)

Batch-transforms CSV/Excel rows using an LLM. Users select input columns and write a transformation instruction (e.g. "Translate to English", "Classify as Positive/Negative/Neutral"). The LLM processes each row independently. Supports abort, temperature control, and per-row retry.

### Generate (`/generate`)

Creates synthetic datasets. Two modes:
- **Schema mode**: user defines columns (name, type, description); LLM generates rows matching the schema.
- **Freeform mode**: user describes the desired dataset in natural language.

Output is parsed from CSV returned by the LLM, displayed in a preview table, and exportable.

### Process Documents (`/process-documents`)

Extracts structured data from PDF, DOCX, TXT, or Markdown files. Text is extracted server-side (web) or browser-side via WASM (Tauri), then passed to the LLM with a structured-extraction prompt. Output is a JSON array of records converted to a downloadable CSV.

### Qualitative Coder (`/qualitative-coder`)

Batch qualitative coding with a user-supplied codebook. Each CSV row is passed to the LLM with the codebook as context. The LLM returns a comma-separated list of applicable codes. Run history is saved (web: Prisma; Tauri: plugin-sql).

### Consensus Coder (`/consensus-coder`)

Multi-model consensus analysis pipeline. Each row goes through:

```
1. Workers (2–5 models, parallel, Promise.allSettled)
   ↓
2. Inter-rater analytics
   ├── Cohen's Kappa (workers 1 vs 2)
   └── N×N pairwise agreement matrix
   ↓
3. Judge model synthesizes worker outputs → final consensus
   ↓
4. [Optional] Quality scoring (judge rates each worker 1–10)
   ↓
5. [Optional] Disagreement analysis (judge explains divergence in one sentence)
```

Requires at least 2 workers to succeed (otherwise throws). Full agreement vs. synthesized disagreement is reported with kappa interpretation label.

### Codebook Generator (`/codebook-generator`)

Three-stage LLM pipeline for generating a qualitative codebook from raw data:

1. **Discovery**: open coding — identifies themes and patterns from data samples
2. **Consolidation**: axial coding — merges overlapping themes, removes rare ones
3. **Definition**: formal codebook — writes inclusion/exclusion criteria and anchor examples for each code

Each stage uses a dedicated prompt and passes its JSON output as input to the next stage.

### Model Comparison (`/model-comparison`)

Runs the same prompt across multiple configured models simultaneously (`Promise.all`). Results displayed side-by-side in a scrollable table. Individual model failures are shown as error strings without aborting the others.

### AI Coder (`/ai-coder`)

AI-assisted qualitative coding with human review. For each row, the LLM suggests applicable codes from a user-supplied codebook. The researcher then accepts, rejects, or modifies the suggestion. Features: autosave, session recovery, word highlighter, keyboard shortcuts, session analytics, coded table panel, CSV export.

### Manual Coder (`/manual-coder`)

Human-only qualitative coding interface. No LLM involvement. Features: multi-column display, word highlighter, keyboard-driven navigation (arrow keys, `Enter` to assign), session save/load (JSON), autosave (dual-slot), session analytics (Cohen's Kappa, IRR stats), coded table preview panel, CSV export.

Layout order (top to bottom):
1. Recovery banner (if session was restored)
2. Word highlighter toggle + highlighter panel
3. Text columns display
4. Settings toggles
5. Code assignment buttons
6. Next row button
7. Session bar: Save · Load · Analytics · Table · CSV · 1/0 · Close
8. Detail panels (highlighter / analytics / table)
9. Navigation bar (Previous · row counter · Next)
10. Progress bar

### History (`/history`)

Lists past runs with pagination, provider/model/status info, and result counts. Click a run to view per-row results with input, output, latency, and status. Supports run deletion.

**Routing difference by deployment:**
- Web: list links to `/history/[id]` (dynamic route, server-rendered)
- Tauri: list links to `/history?id=uuid` (detail rendered inline via `useSearchParams()`)

`RunDetailClient.tsx` is the shared client component imported by both routing paths.

### Settings (`/settings`)

Two-column layout: 160 px sticky navigation sidebar + flex-1 content.

Sections:
- **Providers**: grouped Cloud APIs / Local+Self-hosted. Each provider has status dot (green = ready, amber = no key, muted = disabled), API key field, model input, optional base URL.
- **Prompt Templates**: collapsible sections per category. Each prompt shows current value (override or default), a textarea editor, a "Save override" button, and a "Reset to default" button.
- **Local Providers**: shows detected models as clickable pills + manual refresh button.

---

## 9. API Routes (Web Deployment)

Excluded from the Tauri static export. Equivalent logic is in `llm-browser.ts` and `db-tauri.ts` for the Tauri path.

All routes validate input with Zod schemas from `src/lib/validation.ts`. `apiKey: z.string().default("")` — empty string is valid (local providers require no key).

### `POST /api/process-row`

```typescript
// Request
{ provider, model, apiKey, baseUrl?, systemPrompt, userContent, temperature?, maxTokens? }

// Response
{ output: string, latency: number }
```

Optionally creates a `RunResult` record in Prisma (isolated `try/catch` — never blocks the LLM response).

---

### `POST /api/generate-row`

```typescript
// Request
{ provider, model, apiKey, baseUrl?, rowCount, columns?, freeformPrompt?, temperature? }

// Response
{ rows: Record<string, string>[], rawCsv: string, count: number }
```

---

### `POST /api/comparison-row`

```typescript
// Request
{
  models: Array<{ id, provider, model, apiKey, baseUrl? }>,
  systemPrompt, userContent, temperature?
}

// Response
{ results: Array<{ id, output, latency?, success }> }
```

Runs all models in parallel. Individual failures return `{ success: false, output: "ERROR: ..." }`.

---

### `POST /api/consensus-row`

```typescript
// Request
{
  workers: Array<{ provider, model, apiKey, baseUrl? }>,
  judge: { provider, model, apiKey, baseUrl? },
  workerPrompt, judgePrompt, userContent,
  enableQualityScoring?, enableDisagreementAnalysis?
}

// Response: ConsensusResult
{
  workerResults: WorkerResult[],
  judgeOutput: string,
  judgeLatency: number,
  consensusType: "Full Agreement" | "Disagreement (Synthesized)",
  kappa: number | null,
  kappaLabel: string,
  agreementMatrix: AgreementMatrix,
  qualityScores?: number[],       // if enableQualityScoring = true
  disagreementReason?: string,    // if enableDisagreementAnalysis = true and disagreement
}
```

---

### `POST /api/automator-row`

```typescript
// Request
{
  row: Record<string, unknown>,
  steps: Array<{
    name: string,
    task: string,
    input_fields: string[],
    output_fields: Array<{ name, type, constraints? }>
  }>,
  provider, model, apiKey, baseUrl?
}

// Response
{
  output: Record<string, unknown>,  // cumulative context after all steps
  stepResults: Array<{ step, output?, raw?, success, error? }>,
  success: boolean
}
```

Steps run sequentially. Each step's JSON output is merged into a cumulative context object. The next step receives the merged context (full history available via `input_fields: []`).

---

### `POST /api/document-extract`

```typescript
// Request (multipart/form-data)
{ file: File, provider, model, apiKey, baseUrl?, systemPrompt? }

// Response
{ records: Record<string, unknown>[], fileName, charCount, count }
```

---

### `GET /api/local-models`

```typescript
// Response
{
  ollama: { available: boolean, models: string[] },
  lmstudio: { available: boolean, models: string[] }
}
```

Probes `localhost:11434/api/tags` (Ollama) and `localhost:1234/v1/models` (LM Studio) server-side, avoiding browser CORS restrictions.

---

### `GET /api/runs`, `POST /api/runs`

```typescript
// GET Response
{ runs: RunMeta[], total, limit, offset }

// POST Request
{ runType?, provider?, model?, temperature?, systemPrompt?, inputFile?, inputRows? }
// POST Response
{ id: string }
```

---

### `GET /api/runs/[id]`, `DELETE /api/runs/[id]`

```typescript
// GET Response
{ run: RunMeta, results: RunResult[] }

// DELETE Response
{ ok: true }
```

---

### `POST /api/results`

```typescript
// Request
{
  runId: string,
  results: Array<{ rowIndex, input, output, status?, latency?, errorType?, errorMessage? }>
}

// Response
{ count: number, success: boolean }
```

Uses a Prisma transaction for atomic batch insert.

---

## 10. Database Layer

### Web — SQLite via Prisma 6

Schema (`prisma/schema.prisma`):

```
Session
  id           String  @id
  name         String
  mode         String
  settingsJson String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  runs         Run[]

Run
  id             String   @id
  sessionId      String
  runType        String
  provider       String
  model          String
  temperature    Float
  systemPrompt   String
  inputFile      String?
  inputRows      Int
  status         String   // "processing" | "completed" | "failed"
  startedAt      DateTime @default(now())
  completedAt    DateTime?
  successCount   Int      @default(0)
  errorCount     Int      @default(0)
  avgLatency     Float    @default(0)
  session        Session  @relation(...)
  results        RunResult[]

RunResult
  id           String   @id
  runId        String
  rowIndex     Int
  inputJson    String
  output       String
  status       String   // "success" | "error"
  latency      Float
  errorType    String?
  errorMessage String?
  createdAt    DateTime @default(now())
  run          Run      @relation(...)
```

DB file: `prisma/dev.db`. Prisma client singleton in `src/lib/prisma.ts` avoids multiple connections during Next.js hot reload.

### Tauri — SQLite via tauri-plugin-sql

Identical logical schema, applied via migration in `main.rs`:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL,
  settingsJson TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, sessionId TEXT NOT NULL,
  runType TEXT NOT NULL DEFAULT 'full', provider TEXT NOT NULL DEFAULT 'openai',
  model TEXT NOT NULL DEFAULT 'unknown', temperature REAL NOT NULL DEFAULT 0.7,
  maxTokens INTEGER NOT NULL DEFAULT 2048, systemPrompt TEXT NOT NULL DEFAULT '',
  schemaJson TEXT NOT NULL DEFAULT '{}', variablesJson TEXT NOT NULL DEFAULT '{}',
  inputFile TEXT NOT NULL DEFAULT 'unnamed', inputRows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  successCount INTEGER NOT NULL DEFAULT 0, errorCount INTEGER NOT NULL DEFAULT 0,
  retryCount INTEGER NOT NULL DEFAULT 0, avgLatency REAL NOT NULL DEFAULT 0.0,
  startedAt TEXT NOT NULL DEFAULT (datetime('now')), completedAt TEXT,
  FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS run_results (
  id TEXT PRIMARY KEY, runId TEXT NOT NULL, rowIndex INTEGER NOT NULL,
  inputJson TEXT NOT NULL, output TEXT NOT NULL, status TEXT NOT NULL,
  errorType TEXT, errorMessage TEXT, latency REAL NOT NULL DEFAULT 0.0,
  retryAttempt INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (runId) REFERENCES runs(id) ON DELETE CASCADE
);
```

DB location: `~/Library/Application Support/me.saqr.handai/handai.db` (macOS).

Migrations run automatically on first launch via `tauri-plugin-sql`'s migration system before the WebView loads.

---

## 11. Prompt System

The prompt registry (`prompts.ts`) provides 15 built-in system prompts. Prompts are referenced by `id` (e.g. `"qualitative.default"`) and fetched via `getPrompt(id)`.

**Override flow:**
```
getPrompt("qualitative.default")
  → check localStorage["handai_prompt_override:qualitative.default"]
  → if present: return override value
  → else: return built-in defaultValue
```

The Settings page displays all 15 prompts grouped by category. Each has a textarea editor that calls `setPromptOverride(id, value)` on save, and a "Reset" button that calls `clearPromptOverride(id)`.

---

## 12. Tauri Desktop App

Location: `web/desktop/tauri/`

### Architecture (Phase B — no sidecar)

| Component | Implementation |
|---|---|
| Frontend | Next.js static export (`out/`) served from `tauri://localhost` |
| LLM calls | Browser `fetch()` directly from WKWebView to provider HTTPS endpoints |
| Database | `@tauri-apps/plugin-sql` → SQLite in OS app data dir |
| Document parsing | `pdfjs-dist` WASM + `mammoth` browser build (in-browser) |
| File save | Rust `save_file` command → `blocking_save_file()` → OS native dialog |
| Window state | `tauri-plugin-window-state` (auto-restore on init, no manual call) |

### Rust entry point (`src-tauri/src/main.rs`)

```rust
fn main() {
    tauri::Builder::default()
        .plugin(SqlBuilder::default()
            .add_migrations("sqlite:handai.db", migrations)
            .build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Creates OS app data dir; plugin-sql writes DB here automatically
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir).ok();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![save_file])
        .run(tauri::generate_context!())
}
```

### Tauri plugins

| Plugin | Purpose |
|---|---|
| `tauri-plugin-sql` (sqlite feature) | Read/write SQLite from TypeScript via `@tauri-apps/plugin-sql` |
| `tauri-plugin-window-state` | Persist and restore window size/position across sessions |
| `tauri-plugin-dialog` | Native OS save-file dialog for CSV export |

All permissions declared in `src-tauri/capabilities/default.json`.

### Tauri-specific routing

`/history/[id]` is a dynamic route — incompatible with `output: 'export'`. Solution:

| Deployment | Detail routing |
|---|---|
| Web | `router.push('/history/uuid')` → standard dynamic route |
| Tauri | `router.push('/history?id=uuid')` → detail rendered inline in `history/page.tsx` via `useSearchParams()` |

`history/[id]/page.tsx` is excluded from the Tauri build (shell script moves it to `/tmp`). `RunDetailClient.tsx` is shared: imported by `[id]/page.tsx` (web) and `history/page.tsx` (Tauri).

`useSearchParams()` requires a `<Suspense>` boundary — `history/page.tsx` wraps `<HistoryContent>` (which calls the hook) in `<Suspense fallback={<Loader2 />}>`.

### Dev vs. production

| Mode | Tauri command | Next.js output | LLM path |
|---|---|---|---|
| Dev | `npm run tauri dev` | Dev server on `:3000` | Web API routes (but `isTauri = true`) |
| Production | `npm run tauri build` | Static `out/` | Browser-direct via `llm-browser.ts` |

In dev mode, Tauri points at the Next.js dev server, so API routes are available. In production, the static export has no API routes — all LLM calls go through `llm-browser.ts`.

### Bundle size

- Tauri app: ~10 MB (system WebView, no bundled Chromium or Node.js)
- Electron equivalent: ~150–200 MB (bundled Chromium + Node.js)

---

## 13. Build System

### Web deployment

```bash
npm run build
# next.config.ts: output: 'standalone'
# → .next/standalone/server.js + .next/standalone/node_modules/
```

Deploy with:
```bash
node .next/standalone/server.js           # Node.js
# or
docker build -t handai . && docker run -p 3000:3000 handai
```

### Tauri static export

```bash
npm run build:tauri
```

The `build:tauri` script is a shell one-liner with a `trap EXIT` for safe cleanup:

```bash
bash -c '
  set -e
  trap "
    [ -d /tmp/handai_api_backup ]    && mv /tmp/handai_api_backup src/app/api         || true
    [ -f /tmp/handai_histid_page.tsx ] && mv /tmp/handai_histid_page.tsx src/app/history/\[id\]/page.tsx || true
  " EXIT
  mv src/app/api /tmp/handai_api_backup
  mv "src/app/history/[id]/page.tsx" /tmp/handai_histid_page.tsx
  TAURI_BUILD=1 next build
'
```

Why: `output: 'export'` is incompatible with API routes and dynamic routes. Shell trap restores both on exit regardless of success or failure.

### Tauri desktop build

```bash
cd web/desktop/tauri
npm run tauri build              # produces .app (macOS), .exe (Windows), .AppImage (Linux)
npm run tauri build -- --bundles app   # .app only (skips DMG — no code signing required)
```

Production bundle location:
- macOS: `src-tauri/target/release/bundle/macos/Handai.app`
- Windows: `src-tauri/target/release/bundle/nsis/Handai_x.y.z_x64-setup.exe`
- Linux: `src-tauri/target/release/bundle/appimage/handai_x.y.z_amd64.AppImage`

### Environment variable

| Variable | Value | Effect |
|---|---|---|
| `TAURI_BUILD` | `"1"` | Switches `next.config.ts` to `output: 'export'` |
| (unset) | — | `output: 'standalone'` (default) |

---

## 14. Testing

```bash
cd web
npm test         # Vitest — 76 tests in 4 suites
npm run build    # TypeScript strict check across all 24 routes (0 errors required)
```

| Suite | Tests | What is covered |
|---|---|---|
| `analytics.test.ts` | 23 | `cohenKappa` edge cases (empty, single category, perfect agreement, negative kappa), `pairwiseAgreement` matrix shape, `interpretKappa` all bands |
| `prompts.test.ts` | 14 | Prompt registry completeness, category filtering, `getPrompt` with and without override, `setPromptOverride`, `clearPromptOverride`, SSR safety |
| `retry.test.ts` | 10 | Success on first attempt, retry with backoff, exhausted retries, non-retryable error fast-throw, `maxAttempts` and `baseDelayMs` options |
| `validation.test.ts` | 29 | All 7 Zod schemas: required fields, optional fields, empty `apiKey` accepted, invalid types rejected, `temperature` range, array validation |

Tests are colocated with source files or in `__tests__/` subdirectories. Vitest config in `vitest.config.ts`.

---

## 15. Stability Properties

| Property | Implementation |
|---|---|
| LLM errors never masked | DB log writes are wrapped in their own isolated `try/catch`. A Prisma error never prevents the LLM result from being returned to the page. |
| Worker failures isolated | `Promise.allSettled` is used for all worker arrays. A failed worker is recorded but does not abort the batch. Throws only if fewer than 2 workers succeed (minimum for kappa calculation). |
| Auth errors not retried | `withRetry` detects 401/403/`invalid_api_key`/`authentication`/`authorization` in the error message and rethrows immediately. No wasted delay on misconfigured API keys. |
| Hydration-safe localStorage | All `localStorage` reads happen inside `useEffect(() => {}, [])`. Never in render or `useState` initializer. Prevents SSR ↔ client hydration mismatch. |
| `isTauri` guard in effects | When `isTauri` affects JSX output, detection runs in `useEffect` with a `useState(false)` init. The first render always matches the server-rendered HTML. |
| Abort support | `abortRef` (`useRef<AbortController>`) is used in Transform, Automator, Consensus Coder, and Model Comparison. The "Stop" button calls `abortRef.current.abort()`. |
| Input validation | Zod schemas on all 10 API routes. Malformed requests return 400 with a structured error. Empty `apiKey` is valid (local providers). |
| Prompt persistence | 15 prompts editable in Settings with per-prompt `localStorage` override. `getPrompt()` is safe on server (no-ops `localStorage` access). |
| Dual-slot autosave | Prevents total data loss on crash or accidental navigation. One level of undo against a corrupt write. Final sync write on `beforeunload` via `stateRef`. |
| New providers visible to existing users | Zustand `persist` merge function always spreads `DEFAULT_PROVIDERS` before saved state, so new providers in future versions appear without migration. |

---

## 16. Key Design Decisions

| Decision | Rationale |
|---|---|
| **Dual LLM call path via runtime detection** | Tauri has no server process. `getModel()` and `withRetry()` use only standard `fetch`, so they run identically in Node.js API routes and browser WebView. No code duplication; no behavioral divergence. |
| **API keys in browser localStorage for Tauri** | Desktop users own and manage their own keys. The trade-off: keys are not protected by a server environment, but the app is entirely self-contained at ~10 MB. Acceptable for a desktop research tool. |
| **Vercel AI SDK as the unified LLM interface** | Single abstraction over 10+ provider SDKs. The same `generateText()` call works across all providers. Provider-specific details (auth headers, base URLs, rate-limit formats) are encapsulated in `getModel()`. |
| **Static export for Tauri (no sidecar)** | Phase A used a Node.js sidecar (spawning `server.js` as a child process). Phase B eliminates it: no server boot time (~2 s delay), no Node.js binary to bundle (~50 MB), no port conflicts. Instant window open. |
| **Shell script exclusion for Tauri build** | Next.js `output: 'export'` is incompatible with API routes and dynamic route segments. Shell `trap EXIT` approach: temporarily moves incompatible files to `/tmp`, builds, restores on exit — even on build failure. Cleaner than maintaining two separate Next.js configs. |
| **`history/[id]` inline via search params in Tauri** | `generateStaticParams() { return [] }` is treated identically to "missing" by Next.js — empty array does not satisfy `output: 'export'`. Solution: exclude `[id]/page.tsx` from Tauri build, implement detail inline in `history/page.tsx` via `?id=uuid`. `RunDetailClient.tsx` is shared. |
| **`Promise.allSettled` for consensus workers** | A multi-model consensus analysis should degrade gracefully. One failing provider (e.g. rate-limit) should not abort a 5-worker analysis. Only thrown if fewer than 2 workers succeed (kappa requires at least 2). |
| **`withRetry` non-retryable fast-throw** | Auth errors and bad-request errors will fail on every attempt. Retrying them wastes latency and confuses users. Fast detection via error message token matching. |
| **Zustand + localStorage (no server auth)** | No user accounts, no sessions, no database for configuration. State survives browser refresh and is trivially portable across both web and Tauri targets. Merge strategy prevents data loss when new providers are added. |
| **Prisma (web) / plugin-sql (Tauri) — same schema** | One logical schema, two access layers. Web uses Prisma ORM for type safety. Tauri uses plugin-sql because Prisma requires Node.js. Identical SQL structure means the History page (`RunDetailClient`) works with either. |
| **`"__TAURI_INTERNALS__"` not `"__TAURI__"`** | `__TAURI__` is the Tauri v1 detection signal. `__TAURI_INTERNALS__` is the correct v2 signal. Using the wrong one would silently treat Tauri v2 as web. |
| **`useEffect`-based `isTauri` detection** | Module-level `const isTauri = "__TAURI_INTERNALS__" in window` works for logic, but when the value affects rendered JSX, the server renders `false` and the client would immediately flip to `true` — hydration mismatch. `useEffect` + `useState(false)` ensures the first client render matches the server. |
| **Dual-slot autosave** | Single-slot autosave can be overwritten with a corrupt state (mid-write crash). Two slots give one level of undo, protecting hours of coding work. |

---

## 17. Architecture Layers — Summary

| Layer | Web deployment | Tauri desktop |
|---|---|---|
| **Presentation** | Next.js App Router, React 19, Tailwind v4, shadcn/ui | Same (static export) |
| **State** | Zustand + localStorage | Same |
| **LLM orchestration** | Next.js API routes | `llm-browser.ts` (in-browser) |
| **Model abstraction** | `getModel()` — `@ai-sdk/*` | Same (pure fetch, runs in WebView) |
| **Retry logic** | `withRetry()` — pure JS | Same |
| **Analytics** | `analytics.ts` — pure JS | Same |
| **Document parsing** | Node.js `pdf-parse` + `mammoth` CommonJS | `pdfjs-dist` WASM + `mammoth` browser |
| **Database** | Prisma 6 → SQLite (`prisma/dev.db`) | `@tauri-apps/plugin-sql` → SQLite (`handai.db`) |
| **File export** | Blob URL + `<a download>` | Tauri `save_file` → native OS dialog |
| **Local model detection** | Server-side fetch (no CORS) | Browser fetch (no CORS in WebView) |
| **Runtime** | Node.js 22 | Tauri v2 + WKWebView/WebView2 |
| **Bundle size** | ~250 MB Docker / hosted | ~10 MB |
