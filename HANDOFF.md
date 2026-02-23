# Session Handoff — 2026-02-22

## Completed This Session

### Phase B: Remove Electron + Tauri no-sidecar migration

**Part A — Electron removal**
- Deleted `web/desktop/electron/` entirely
- Stripped all Electron mentions from README.md, ARCHITECTURE.md, HANDOFF.md, desktop/README.md
- `web/next.config.ts` comment fixed: "Tauri" (was "Electron and Tauri")

**Part B — Tauri Phase B migration (no sidecar)**
- `web/src/lib/llm-browser.ts` — NEW: browser-side LLM functions wrapping `generateText()` + `withRetry()`:
  - `processRowDirect`, `generateRowDirect`, `comparisonRowDirect`, `consensusRowDirect`, `automatorRowDirect`, `documentExtractDirect`
- `web/src/lib/document-browser.ts` — NEW: browser PDF/DOCX extraction using `pdfjs-dist` (WASM) and `mammoth` browser build
- `web/src/lib/db-tauri.ts` — NEW: TypeScript wrappers over `@tauri-apps/plugin-sql` for `createRun`, `listRuns`, `getRun`, `deleteRun`, `saveResults`
- **9 pages updated** with `isTauri` branching: qualitative-coder, consensus-coder, transform, automator, generate, model-comparison, ai-coder, process-documents, history
- `AppSidebar.tsx` — Tauri-aware local model detection (direct browser fetch to Ollama/LM Studio instead of `/api/local-models`)
- `web/next.config.ts` — dual output: `standalone` (web) vs `export` (Tauri build)
- `web/package.json` — `build:tauri` script (shell trap to temporarily remove `api/` + `history/[id]/page.tsx`)
- `src-tauri/Cargo.toml` — removed `tauri-plugin-shell`, added `tauri-plugin-sql` with sqlite feature
- `src-tauri/src/main.rs` — removed sidecar spawn/TCP poll, added SQL plugin with SQLite migrations (`sessions`, `runs`, `run_results`)
- `src-tauri/tauri.conf.json` — `frontendDist: "../../out"`, updated build commands, removed sidecar config
- `src-tauri/capabilities/default.json` — added `sql:*` permissions, removed `shell:*`

**History page architecture (Tauri-specific)**
- `history/[id]/RunDetailClient.tsx` — NEW: extracted client component with isTauri branching
- `history/[id]/page.tsx` — thin server wrapper (web only; excluded from Tauri build)
- `history/page.tsx` — Tauri: detects `?id=` search param → shows `RunDetailClient` inline; list uses `router.push('/history?id=uuid')` in Tauri mode

---

## Current State

### Builds
- `npm run build` → ✅ 0 TS errors, 24 routes (standalone + API + `/history/[id]`)
- `npm run build:tauri` → ✅ 16 static pages in `out/`
- `npm test` → ✅ 76/76 tests pass

### Tauri architecture (Phase B)
- No Node.js sidecar: window opens instantly
- LLM calls: browser-side via AI SDK (`llm-browser.ts`)
- PDF/DOCX: browser extraction via `pdfjs-dist` + `mammoth` (`document-browser.ts`)
- DB: `@tauri-apps/plugin-sql` SQLite (`db-tauri.ts`)
- History detail: inline in `/history?id=uuid` (no dynamic route)
- Local model detection: direct browser fetch (no CORS issue in desktop WebView)
- CSV export: native OS save dialog via `save_file` Tauri command

### Web deployment
- All existing API routes unchanged; `/history/[id]` web route unchanged
- Standalone output for server deployment

### Not yet done
- Tauri production build (`tauri build`) — untested; needs:
  - `cargo build --release` in `src-tauri/`
  - Verify SQLite migrations run correctly on first launch
  - Verify `handai.db` is created in `app_data_dir()`
  - Code signing for macOS distribution
- GitHub Actions CI for Tauri builds

---

## Key Decisions Made

1. **`build:tauri` shell script exclusion** — Next.js `output: 'export'` cannot handle any dynamic routes or API handlers. Shell trap approach: temporarily move `src/app/api/` + `src/app/history/[id]/page.tsx` before building, restore on EXIT regardless of outcome. Cleaner than maintaining two separate Next.js configs.

2. **`history/[id]` handled via search params in Tauri** — `generateStaticParams() { return [] }` is treated as "missing" by Next.js export (empty array = no pages). Solution: exclude `[id]/page.tsx` from Tauri build, show detail view inline in `history/page.tsx` via `?id=uuid`. Web deployment keeps the full `/history/[id]` route.

3. **`useSearchParams` needs Suspense** — Added `<Suspense>` wrapper to `history/page.tsx` with a loading spinner fallback. The actual logic is in `HistoryContent` which uses `useSearchParams()`.

4. **`isTauri` in list links** — Changed history list from `<Link href="/history/uuid">` to `div onClick={() => router.push(isTauri ? '/history?id=uuid' : '/history/uuid')}`. `isTauri` is detected in `useEffect` (not module level) to avoid hydration mismatch.

5. **`generateStaticParams` must be server component** — Cannot appear in a `"use client"` file. Split `[id]/page.tsx` into a server wrapper (`page.tsx`) + `RunDetailClient.tsx` (client component). The server wrapper is excluded from Tauri build; the client component is importable from `history/page.tsx`.

---

## Open Issues

1. **Tauri production build untested** — `cargo build --release` + `tauri build` not yet run. SQLite migration correctness unverified in production bundle.
2. **CORS for Anthropic/Google in Tauri WebView** — AI SDK calls go directly from WKWebView to API endpoints. Anthropic and Google may block requests without `Origin: tauri://localhost` in CORS allowlist. If they do, add `tauri-plugin-http` for those providers only.
3. **`pdfjs-dist` worker URL in static export** — `new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url)` relies on webpack/turbopack asset resolution. Verify it copies the worker file to `out/_next/static/` correctly.
4. **`dynamic = 'force-dynamic'` on API routes** — Added during troubleshooting to 8 API route files. These are NOT needed for web build (Next.js already infers dynamic from use of request/headers). Remove them if they cause issues.

---

## Next Steps (Prioritized)

1. **Test `tauri dev`** — `cd web/desktop/tauri && npm run tauri dev` — verify LLM calls work from WebView, history DB works, local model detection works
2. **Run `tauri build`** — verify production bundle, SQLite DB creation, CSV export
3. **CORS check** — Test Anthropic + Google providers in Tauri; add `tauri-plugin-http` if blocked
4. **Remove force-dynamic exports** from API routes if not needed (8 files)
5. **GitHub Actions** — CI for Tauri builds (macOS target)

---

## Environment

```bash
# Web app
node 22, npm 10
Next.js 16.1.6, React 19, TypeScript strict
Tailwind v4, shadcn/ui
Prisma 6 + SQLite (web deployment only)
Vitest (76 tests)

# Tauri Phase B
Rust stable 1.77+
tauri 2, tauri-plugin-sql 2 (sqlite), tauri-plugin-window-state 2, tauri-plugin-dialog 2
@tauri-apps/api, @tauri-apps/plugin-sql (installed in web/)
pdfjs-dist, mammoth (browser builds)

# Builds
npm run build        → web standalone
npm run build:tauri  → out/ static export for Tauri
npm run tauri dev    → run from web/desktop/tauri/

# Git
web/ remote: https://github.com/mohsaqr/handai_refactored.git branch main
All commits from web/ directory only
```
