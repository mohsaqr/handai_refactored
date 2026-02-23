# Handai Web App — Architecture

> Last updated: 2026-02-23 (rev 3)

---

## Overview

Handai is a qualitative and quantitative data analysis suite powered by LLMs. The web app (`web/`) is a Next.js 16 application that can be deployed as a standard web app **or** packaged as a desktop application via Tauri (Phase B — no sidecar, browser-side LLM calls, ~10 MB bundle).

The two deployment targets share identical application code. Runtime detection (`"__TAURI_INTERNALS__" in window`) selects the correct path for LLM calls, database access, and file export.

---

## Directory Structure

```
web/
├── src/
│   ├── app/                    ← Next.js App Router pages + API routes
│   │   ├── api/                ← 10 server-side API routes (web deployment only)
│   │   │   ├── process-row/    ← Single LLM call + optional DB log
│   │   │   ├── generate-row/   ← Generate synthetic CSV rows
│   │   │   ├── comparison-row/ ← Run same prompt across N models in parallel
│   │   │   ├── consensus-row/  ← N workers + judge + inter-rater analytics
│   │   │   ├── automator-row/  ← Sequential multi-step LLM pipeline
│   │   │   ├── document-extract/ ← PDF/DOCX → text → LLM → JSON
│   │   │   ├── local-models/   ← Probe Ollama/LM Studio, return model list
│   │   │   ├── runs/           ← Create / list run records (Prisma)
│   │   │   ├── runs/[id]/      ← Fetch / delete run + results (Prisma)
│   │   │   └── results/        ← Batch-save run results (Prisma transaction)
│   │   ├── ai-coder/           ← AI-assisted qualitative coding (per row)
│   │   ├── manual-coder/       ← Human qualitative coding (keyboard-driven)
│   │   ├── qualitative-coder/  ← Batch LLM coding with codebook
│   │   ├── consensus-coder/    ← Multi-model consensus coding
│   │   ├── codebook-generator/ ← LLM-assisted codebook creation
│   │   ├── transform/          ← Transform CSV rows via LLM
│   │   ├── automator/          ← Multi-step LLM pipeline builder
│   │   ├── generate/           ← Generate synthetic datasets
│   │   ├── process-documents/  ← Extract data from PDFs/DOCX
│   │   ├── model-comparison/   ← Side-by-side model output comparison
│   │   ├── history/            ← Run history list + detail view
│   │   │   └── [id]/           ← Detail page (web only; excluded from Tauri build)
│   │   └── settings/           ← Provider config + prompt template editor
│   ├── components/
│   │   ├── ui/                 ← shadcn/ui component library
│   │   ├── tools/              ← Shared tool components (FileUploader, DataTable, ...)
│   │   └── AppSidebar.tsx      ← Navigation + model indicator + local detection
│   └── lib/
│       ├── ai/providers.ts     ← getModel() factory — pure fetch, runs in Node.js and WebView
│       ├── analytics.ts        ← cohenKappa(), pairwiseAgreement()
│       ├── db-tauri.ts         ← @tauri-apps/plugin-sql wrappers (Tauri path)
│       ├── document-browser.ts ← pdfjs-dist WASM + mammoth browser build (Tauri path)
│       ├── export.ts           ← downloadCSV() — browser blob or Tauri native dialog
│       ├── hooks.ts            ← useActiveModel() — first enabled+configured provider
│       ├── llm-browser.ts      ← Browser-side equivalents of all API routes (Tauri path)
│       ├── prisma.ts           ← Prisma client singleton (dev hot-reload safe)
│       ├── prompts.ts          ← Prompt registry + localStorage override system
│       ├── retry.ts            ← withRetry() — pure JS, runs in Node.js and WebView
│       ├── sample-data.ts      ← 6 seeded sample datasets
│       ├── store.ts            ← Zustand store (providers config, persisted to localStorage)
│       └── validation.ts       ← Zod schemas for all API routes
├── prisma/
│   ├── schema.prisma           ← SQLite schema (Session, Run, RunResult)
│   └── dev.db                  ← Development database (not committed)
├── desktop/
│   └── tauri/                  ← Tauri wrapper (Phase B: browser-side LLM + plugin-sql)
├── next.config.ts              ← Dual output: 'standalone' (web) or 'export' (Tauri)
└── package.json
```

---

## Dual LLM Call Path

Every tool page performs runtime detection once at mount:

```typescript
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
```

### Web path (`isTauri = false`)

```
Page component
  → fetch('/api/process-row', { provider, model, apiKey, userContent })
    → ProcessRowSchema.safeParse() — Zod validation
    → getModel(provider, model, apiKey, baseUrl) → LanguageModelV3
    → withRetry(() => generateText({ model, system, prompt, temperature }))
      → ai SDK → provider API
    → [optional] prisma.runResult.create()  ← isolated try/catch, never masks LLM result
    → { output, latency }
```

DB access goes through Prisma → SQLite (`prisma/dev.db`).

### Tauri path (`isTauri = true`)

```
Page component
  → processRowDirect(params)  ← from src/lib/llm-browser.ts
    → getModel(provider, model, apiKey, baseUrl) → LanguageModelV3
    → withRetry(() => generateText({ model, system, prompt, temperature }))
      → ai SDK → provider API  (direct from WebView, no proxy)
    → [optional] createRun(params) from src/lib/db-tauri.ts
      → @tauri-apps/plugin-sql → SQLite (handai.db in app data dir)
    → { output, latency }
```

**Key insight**: `getModel()` (`providers.ts`) and `withRetry()` (`retry.ts`) use only standard `fetch` — they run identically in Node.js and in WKWebView. No code duplication, no divergence in retry or error-handling behavior.

**API key handling in Tauri**: API keys are stored in localStorage (same as web) and used directly from the WebView. Desktop users manage their own keys. This is the intentional trade-off for the ~10 MB, server-free desktop bundle.

---

## llm-browser.ts — Browser-Direct LLM Functions

Each function mirrors the corresponding API route:

| Function | Mirrors |
|---|---|
| `processRowDirect` | `/api/process-row` |
| `generateRowDirect` | `/api/generate-row` |
| `comparisonRowDirect` | `/api/comparison-row` |
| `consensusRowDirect` | `/api/consensus-row` (workers + judge + kappa) |
| `automatorRowDirect` | `/api/automator-row` |
| `documentExtractDirect` | `/api/document-extract` |

---

## document-browser.ts — Browser-Side Document Parsing

Used in Tauri (and progressively on web) to avoid server-side file handling:

| File type | Library |
|---|---|
| `.pdf` | `pdfjs-dist` (WASM worker via `new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url)`) |
| `.docx` | `mammoth.extractRawText({ arrayBuffer })` (browser build) |
| `.txt` / `.md` | `file.text()` |

---

## Auto-Detection of Local Models

| Deployment | Mechanism |
|---|---|
| Web | `fetch('/api/local-models')` — server-side probe, no CORS |
| Tauri | Direct browser fetch to `localhost:11434` and `localhost:1234` — no CORS in desktop WebView |

Both paths update the Zustand store identically:

```
AppSidebar mount
  → probe Ollama (:11434/api/tags) and LM Studio (:1234/v1/models)
  → if models found:
      setProviderConfig(id, { isEnabled: true, defaultModel: firstModel })
      toast.success("Ollama detected — 3 models available")
```

---

## Build System — Dual Output Mode

### Web deployment

```bash
npm run build
# next.config.ts: output: 'standalone'
# → .next/standalone/server.js
```

### Tauri static export

```bash
npm run build:tauri
# Shell script that:
# 1. Moves src/app/api/ to /tmp          (API routes incompatible with static export)
# 2. Moves src/app/history/[id]/ to /tmp (dynamic route requires pre-rendered params)
# 3. Runs: TAURI_BUILD=1 next build      (next.config.ts switches to output: 'export')
#    → out/  (static files, no server needed)
# 4. Restores both paths on exit (trap EXIT)
```

The `TAURI_BUILD=1` env var is the only signal to `next.config.ts` to switch output modes. No application code changes between builds.

---

## History Page Routing (Tauri-Specific)

`/history/[id]` is a dynamic route that requires a running Next.js server — incompatible with `output: 'export'`.

| Deployment | Routing |
|---|---|
| Web | `router.push('/history/[id]')` — standard dynamic route |
| Tauri | `router.push('/history?id=uuid')` — detail rendered inline in `/history` via `useSearchParams()` |

`history/[id]/page.tsx` is excluded from the Tauri build, but `RunDetailClient.tsx` is shared — imported by both `history/[id]/page.tsx` (web) and `history/page.tsx` (Tauri inline path).

---

## Desktop Packaging — Tauri (web/desktop/tauri/)

Phase B architecture: no sidecar, no bundled Node.js, instant startup.

| Aspect | Detail |
|---|---|
| LLM calls | Browser `fetch()` directly to provider APIs from WKWebView |
| Database | `@tauri-apps/plugin-sql` → SQLite (`handai.db` in OS app data dir) |
| Document parsing | `pdfjs-dist` (WASM) + mammoth browser build |
| Runtime detection | `"__TAURI_INTERNALS__" in window` (Tauri v2 signal; v1 used `__TAURI__`) |
| CSV export | WKWebView ignores HTML `download` attribute — detect Tauri, invoke `save_file` Rust command → `blocking_save_file()` → OS native save dialog |
| Bundle size | ~10 MB (system WebView; no bundled Chromium or Node.js) |
| Window state | `tauri-plugin-window-state` auto-restores size/position on init |

**Tauri plugins in use**:

| Plugin | Purpose |
|---|---|
| `tauri-plugin-sql` | SQLite DB access from TypeScript frontend |
| `tauri-plugin-window-state` | Persist and restore window size/position |
| `tauri-plugin-dialog` | Native OS save-file dialog for CSV export |

**Dev command**: `cd web/desktop/tauri && npm run tauri dev`

All plugin permissions must be declared in `src-tauri/capabilities/default.json`.

---

## Database Schema

### Web — SQLite via Prisma (`prisma/schema.prisma`)

```
Session       ← groups related runs
  id, name, mode, settingsJson, createdAt

Run           ← one batch execution
  id, sessionId, runType, provider, model, temperature
  systemPrompt, inputFile, inputRows, status
  startedAt, completedAt, successCount, errorCount, avgLatency

RunResult     ← one row result within a run
  id, runId, rowIndex, inputJson, output, status, latency
  errorType, errorMessage
```

### Tauri — SQLite via tauri-plugin-sql (`db-tauri.ts` + migrations in `main.rs`)

Identical structure, different access layer:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, name TEXT, mode TEXT, settingsJson TEXT, createdAt TEXT
)
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, sessionId TEXT, runType TEXT, provider TEXT, model TEXT,
  temperature REAL, systemPrompt TEXT, inputFile TEXT, inputRows INTEGER, status TEXT,
  startedAt TEXT, completedAt TEXT, successCount INTEGER, errorCount INTEGER, avgLatency REAL
)
CREATE TABLE IF NOT EXISTS run_results (
  id TEXT PRIMARY KEY, runId TEXT, rowIndex INTEGER, inputJson TEXT, output TEXT,
  status TEXT, latency REAL, errorType TEXT, errorMessage TEXT
)
```

---

## API Routes (Web Deployment Only)

Not compiled into the Tauri static export. Equivalent logic lives in `llm-browser.ts` and `db-tauri.ts` for the Tauri path.

| Route | Methods | Purpose | DB | LLM |
|---|---|---|---|---|
| `/api/process-row` | POST | Single row transform | Optional log | 1 call |
| `/api/generate-row` | POST | Synthetic data generation | None | 1 call |
| `/api/comparison-row` | POST | N models, same prompt | None | N parallel |
| `/api/consensus-row` | POST | N workers + judge + Kappa | Optional log | N+1–3 calls |
| `/api/automator-row` | POST | Sequential K-step pipeline | None | K sequential |
| `/api/document-extract` | POST | PDF/DOCX → JSON | None | 1 call |
| `/api/local-models` | GET | Probe localhost:11434/1234 | None | None |
| `/api/runs` | GET, POST | List / create run records | Read/Write | None |
| `/api/runs/[id]` | GET, DELETE | Fetch / delete run | Read/Delete | None |
| `/api/results` | POST | Batch-save results (atomic) | Transaction | None |

---

## Supported LLM Providers

| Provider | Type | SDK | Notes |
|---|---|---|---|
| OpenAI | Cloud | `@ai-sdk/openai` | Base URL configurable (proxies) |
| Anthropic | Cloud | `@ai-sdk/anthropic` | — |
| Google Gemini | Cloud | `@ai-sdk/google` | — |
| Groq | Cloud | `@ai-sdk/groq` | — |
| Together AI | Cloud | `@ai-sdk/openai` compat | `https://api.together.xyz/v1` |
| Azure OpenAI | Cloud | `@ai-sdk/azure` | Resource name required |
| OpenRouter | Cloud | `@ai-sdk/openai` compat | `https://openrouter.ai/api/v1` |
| Ollama | Local | `@ai-sdk/openai` compat | `http://localhost:11434/v1` |
| LM Studio | Local | `@ai-sdk/openai` compat | `http://localhost:1234/v1` |
| Custom | Local/Cloud | `@ai-sdk/openai` compat | User-provided base URL |

**Active model selection**: `useActiveModel()` returns the first provider where `isEnabled && (isLocal || apiKey !== "")`. Local providers are auto-detected and auto-enabled at startup.

---

## Client-Side State

```
Zustand store (persisted to localStorage key: handai-storage)
  └── providers: Record<providerId, ProviderConfig>
        ├── apiKey, defaultModel, baseUrl
        ├── isEnabled, isLocal
        └── merged with DEFAULT_PROVIDERS on load (new providers always visible)

Per-tool localStorage:
  ├── handai_prompt_*             ← prompt overrides (prompts.ts)
  ├── handai_codebook_qualcoder   ← qualitative coder codebook
  ├── handai_steps_automator      ← automator pipeline steps
  ├── aic_autosave / aic_autosave_prev  ← AI Coder session (dual-slot autosave)
  └── mc_autosave  / mc_autosave_prev  ← Manual Coder session (dual-slot autosave)
```

---

## Autosave System (AI Coder + Manual Coder)

Dual-slot localStorage rotation prevents data loss on crash or accidental refresh:

```
Every state change (data, codes, currentIndex, sessionName, ...):
  → write current state to AUTOSAVE_KEY
  → rotate previous AUTOSAVE_KEY → AUTOSAVE_PREV_KEY  (one level of undo)

beforeunload:
  → final sync write via stateRef (no stale closure)

On mount:
  → try AUTOSAVE_KEY, fallback to AUTOSAVE_PREV_KEY
  → if data found: restore + show amber "Session recovered" banner
  → banner has dismiss; cleared when fresh data loads

Loading new data when codedCount > 0:
  → intercept via pendingLoad state
  → show Dialog: "Replace current session?" / Cancel / Load anyway
```

---

## Settings Page

Two-column layout: 160 px sticky nav sidebar + flex-1 content area.

- **Providers grouped**: Cloud APIs | Local/Self-hosted
- **Status indicators**: green = ready, amber = no API key, muted = disabled
- **Prompt templates**: per-category collapsible sections (15 prompts total)
- **Local providers**: detected models shown as clickable pills + refresh button

---

## Stability Properties

| Property | Implementation |
|---|---|
| LLM errors never masked | DB log writes isolated in their own `try/catch`; never block LLM response return |
| Worker failures isolated | `Promise.allSettled` in consensus path; fails only if fewer than 2 workers succeed |
| Auth errors not retried | `withRetry` detects 401/403/`invalid_api_key` and throws immediately |
| Hydration-safe | All `localStorage` reads happen in mount `useEffect`, never in render or `useState` init |
| `isTauri` guard in effects | When `isTauri` affects JSX, detection runs in `useEffect` to avoid SSR mismatch |
| Abort support | `abortRef` in Transform, Automator, Consensus Coder, Model Comparison |
| Input validation | Zod schemas on all 10 API routes; empty `apiKey` is valid (local providers) |
| Prompt persistence | `localStorage` per tool; Settings page shows and edits all 15 prompts |

---

## Testing

```bash
cd web
npm test        # Vitest — 76 tests across 4 suites
npm run build   # TypeScript type check + production build (0 errors required)
```

| Suite | Tests | Coverage |
|---|---|---|
| `analytics.test.ts` | 23 | `cohenKappa`, `pairwiseAgreement` edge cases |
| `prompts.test.ts` | 14 | Prompt registry, overrides, categories |
| `retry.test.ts` | 10 | Backoff, maxAttempts, non-retryable error detection |
| `validation.test.ts` | 29 | All 7 Zod schemas, edge cases including empty apiKey |

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Dual LLM call path (API routes on web, browser-direct on Tauri) | Tauri has no server process; `getModel()` and `withRetry()` are pure fetch so they run identically in both environments |
| API keys in browser for Tauri | Desktop users manage their own keys in localStorage — intentional trade-off for a ~10 MB, zero-server bundle |
| `getModel()` + `withRetry()` as pure fetch | Single implementation shared by Node.js API routes and WebView direct calls; no behavioral divergence |
| Zustand + localStorage | No auth/session management needed; state survives refresh; trivially portable across both targets |
| Prisma + SQLite (web) / plugin-sql (Tauri) | Identical schema, zero-config, file-based; Tauri variant requires no Node.js |
| Dual output mode (`standalone` / `export`) | Single `next.config.ts` driven by `TAURI_BUILD=1`; no application code changes between builds |
| API routes excluded from Tauri build | Static export (`output: 'export'`) is incompatible with Next.js API routes; shell script moves them before build and restores on exit |
| Dual-slot autosave | One-level undo against corrupt writes; prevents total data loss on crash or accidental navigation |
| `Promise.allSettled` for consensus workers | Partial worker failure must not abort a multi-model consensus analysis |
| `withRetry` non-retryable check | Auth errors should fail immediately, not waste 3× latency before reporting |
| `"__TAURI_INTERNALS__"` detection (not `"__TAURI__"`) | `__TAURI__` is Tauri v1; `__TAURI_INTERNALS__` is the correct v2 signal |
