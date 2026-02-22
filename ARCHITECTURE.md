# Handai Web App — Architecture

> Last updated: 2026-02-22 (rev 2)

---

## Overview

Handai is a qualitative and quantitative data analysis suite powered by LLMs. The web app (`web/`) is a Next.js 16 application that can be deployed as a standard web app **or** packaged as a desktop application via Electron or Tauri without any changes to the application code.

---

## Directory Structure

```
web/
├── src/
│   ├── app/                    ← Next.js App Router pages + API routes
│   │   ├── api/                ← 10 server-side API routes (Node.js)
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
│   │   └── settings/           ← Provider config + prompt template editor
│   ├── components/
│   │   ├── ui/                 ← shadcn/ui component library
│   │   ├── tools/              ← Shared tool components (FileUploader, DataTable, ...)
│   │   └── AppSidebar.tsx      ← Navigation + model indicator + local detection
│   └── lib/
│       ├── ai/providers.ts     ← getModel() factory for all 10 LLM providers
│       ├── analytics.ts        ← cohenKappa(), pairwiseAgreement()
│       ├── export.ts           ← shared downloadCSV() — browser blob or Tauri native dialog
│       ├── hooks.ts            ← useActiveModel() — first enabled+configured provider
│       ├── prisma.ts           ← Prisma client singleton (dev hot-reload safe)
│       ├── prompts.ts          ← Prompt registry + localStorage override system
│       ├── retry.ts            ← withRetry() with non-retryable error detection
│       ├── sample-data.ts      ← 6 seeded sample datasets
│       ├── store.ts            ← Zustand store (providers config, persisted to localStorage)
│       └── validation.ts       ← Zod schemas for all 10 API routes
├── prisma/
│   ├── schema.prisma           ← SQLite schema (Session, Run, RunResult, ...)
│   └── dev.db                  ← Development database (not committed)
├── desktop/
│   ├── electron/               ← Electron wrapper (spawns Next.js standalone server)
│   └── tauri/                  ← Tauri wrapper (sidecar approach)
├── next.config.ts              ← output: 'standalone' for desktop packaging
└── package.json
```

---

## Data Flow

### Client-side state
```
Zustand store (localStorage persisted)
  └── providers: Record<providerId, ProviderConfig>
        ├── apiKey, defaultModel, baseUrl
        ├── isEnabled, isLocal
        └── merged with DEFAULT_PROVIDERS on load (new providers always appear)

Per-tool localStorage:
  ├── handai_prompt_*           ← prompt overrides (prompts.ts)
  ├── handai_codebook_qualcoder ← qualitative coder codebook
  ├── handai_steps_automator    ← automator pipeline steps
  ├── aic_autosave / aic_autosave_prev  ← AI Coder session autosave (dual-slot)
  └── mc_autosave  / mc_autosave_prev  ← Manual Coder session autosave (dual-slot)
```

### LLM call path (all batch tools)
```
Page component
  → p-limit concurrency pool (configurable, default 5)
    → fetch('/api/process-row', { provider, model, apiKey, userContent })
      → ProcessRowSchema.safeParse() validation
      → getModel(provider, model, apiKey, baseUrl) → LanguageModelV3
      → withRetry(() => generateText({ model, system, prompt, temperature }))
        → ai SDK → provider API (OpenAI/Anthropic/Google/Groq/...)
      → [optional] prisma.runResult.create() — isolated try/catch, never masks LLM result
      → { output, latency }
```

### Auto-detection of local models
```
AppSidebar mount
  → fetch('/api/local-models')           ← server-side probe (no CORS)
    → GET http://localhost:11434/api/tags ← Ollama
    → GET http://localhost:1234/v1/models ← LM Studio
  → if models found:
      setProviderConfig(id, { isEnabled: true, defaultModel: firstModel })
      toast.success("Ollama detected — 3 models available")
```

---

## API Routes

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

| Provider | Type | SDK | Base URL |
|---|---|---|---|
| OpenAI | Cloud | @ai-sdk/openai | Configurable (for proxies) |
| Anthropic | Cloud | @ai-sdk/anthropic | — |
| Google (Gemini) | Cloud | @ai-sdk/google | — |
| Groq | Cloud | @ai-sdk/groq | — |
| Together AI | Cloud | @ai-sdk/openai compat | https://api.together.xyz/v1 |
| Azure OpenAI | Cloud | @ai-sdk/azure | Resource name |
| OpenRouter | Cloud | @ai-sdk/openai compat | https://openrouter.ai/api/v1 |
| Ollama | Local | @ai-sdk/openai compat | http://localhost:11434/v1 |
| LM Studio | Local | @ai-sdk/openai compat | http://localhost:1234/v1 |
| Custom | Local/Cloud | @ai-sdk/openai compat | User-provided |

**Active model selection**: `useActiveModel()` returns the first provider where `isEnabled && (isLocal || apiKey !== "")`. Local providers are auto-detected and auto-enabled at startup.

---

## Database Schema (SQLite via Prisma)

```
Session          ← groups related runs
  id, name, mode, settingsJson, createdAt

Run              ← one batch execution
  id, sessionId, runType, provider, model, temperature
  systemPrompt, inputFile, inputRows, status
  startedAt, completedAt, successCount, errorCount, avgLatency

RunResult        ← one row result within a run
  id, runId, rowIndex, inputJson, output, status, latency
  errorType, errorMessage
```

---

## Autosave System (AI Coder + Manual Coder)

Dual-slot localStorage rotation prevents data loss on crash or accidental refresh:

```
Every state change (data, codes, currentIndex, sessionName, ...):
  → save current to AUTOSAVE_KEY
  → rotate old AUTOSAVE_KEY → AUTOSAVE_PREV_KEY (one level of undo)

beforeunload:
  → final sync write via stateRef (no stale closure problem)

On mount:
  → try AUTOSAVE_KEY, fallback to AUTOSAVE_PREV_KEY
  → if data found: restore + show amber "Session recovered" banner
  → banner has dismiss button; cleared when fresh data loads

Loading new data when codedCount > 0:
  → intercept via pendingLoad state
  → show Dialog: "Replace current session?" / Cancel / Load anyway
```

---

## Stability Properties

| Property | Implementation |
|---|---|
| LLM errors never masked | DB log writes are isolated in their own try/catch |
| Worker failures isolated | `Promise.allSettled` in consensus-row; fails only if < 2 workers succeed |
| Auth errors not retried | `withRetry` checks error message for 401/403/invalid_api_key patterns |
| Hydration-safe | All localStorage reads happen in mount `useEffect`, never in render |
| Abort support | `abortRef` in Transform, Automator, Consensus Coder, Model Comparison |
| Input validation | Zod schemas on all 10 API routes; empty apiKey allowed for local providers |
| Prompt persistence | localStorage per tool; Settings page shows/edits all 15 prompts |

---

## Desktop Packaging

The web app builds with `output: "standalone"` which produces a self-contained `server.js` with minimal `node_modules`. Both desktop wrappers use this:

```
npm run build (in web/)
  → .next/standalone/server.js  ← shipped in desktop bundles
  → .next/static/               ← static assets (copied alongside)
  → public/                     ← public assets
```

### Electron (web/desktop/electron/)
- Spawns `server.js` using the **built-in Node.js from Electron itself**
- No separate Node.js installation required
- Polls port 3947 before showing window
- All API routes work unchanged
- Bundle: ~160 MB

### Tauri (web/desktop/tauri/)
- Spawns `server.js` as a `tauri-plugin-shell` sidecar
- Requires bundling a platform Node.js binary in `src-tauri/binaries/`
- System WebView (no bundled Chromium) — **WKWebView on macOS**
- Bundle: ~85 MB (Phase A), ~10 MB after Phase B migration
- **Plugins**: `tauri-plugin-shell` (sidecar), `tauri-plugin-window-state` (size/position), `tauri-plugin-dialog` (native save-file dialog)
- **CSV export**: WKWebView ignores HTML `download` attribute; detect `window.__TAURI_INTERNALS__` and invoke `save_file` command → `blocking_save_file()` → OS save dialog
- **DB path**: production sets `DATABASE_URL=file:{app_data_dir}/handai.db` → `~/Library/Application Support/me.saqr.handai/handai.db`

### Phase B migration path (Tauri only)
1. Move LLM API route logic → direct browser `fetch()` (no server needed)
2. Replace Prisma → `tauri-plugin-sql` raw SQL
3. Replace `pdf-parse` → `pdfjs-dist` (WASM browser build)
4. Result: no sidecar, instant startup, ~10 MB bundle

---

## Testing

```bash
cd web
npm test        # Vitest — 76 tests across 4 suites
npm run build   # TypeScript type check + production build
```

| Test suite | Coverage |
|---|---|
| `analytics.test.ts` | 23 tests — cohenKappa, pairwiseAgreement edge cases |
| `prompts.test.ts` | 14 tests — prompt registry, overrides, categories |
| `retry.test.ts` | 10 tests — backoff, maxAttempts, non-retryable error detection |
| `validation.test.ts` | 29 tests — all 7 Zod schemas, edge cases |

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| All LLM calls server-side | API keys never in browser; consistent error handling; works identically in desktop |
| Zustand + localStorage | No auth/session management needed; state survives refresh; trivially portable |
| Prisma + SQLite | Zero-config DB for run history; file-based, ships in desktop bundle |
| `output: "standalone"` | Enables both Electron and Tauri desktop packaging without any code changes |
| Dual-slot autosave | One-level undo against corrupt writes; prevents total data loss on crash |
| `Promise.allSettled` for workers | Partial worker failure should not abort a consensus analysis |
| `withRetry` non-retryable check | Auth errors should fail fast, not waste 3 × latency before reporting |
