# Session Handoff — 2026-02-24

## Completed This Session

### Documentation
- `ARCHITECTURE.md` — full rewrite (rev 4, 917 lines): system topology diagram, all 17 sections, sourced directly from actual source files. Pushed to `mohsaqr/handai_refactored`.
- `README.md` (web + root) — two-versions comparison table distinguishing Handai JS from Handai Streamlit. Both pushed to their respective repos.
- `desktop/README.md` — full rewrite with platform-specific prerequisites, install steps, dev + production build, output paths, code signing, plugin reference.

### Tauri production build (`tauri build`)
- Fixed `frontendDist` path: `../../out` → `../../../out` (Tauri resolves from `src-tauri/`, not `tauri/`)
- `.app` builds successfully; DMG skipped (no Apple Developer cert) via `--bundles app`
- Output: `src-tauri/target/release/bundle/macos/Handai.app`

### Tauri dev mode verified
- `npm run tauri dev` confirmed working end-to-end: LLM calls, DB writes, history page, local model detection, CSV export

### Cleanup
- Removed `export const dynamic = 'force-dynamic'` from all 10 API route files — Next.js infers dynamic rendering automatically; the explicit export was added during troubleshooting and was never needed

---

## Current State

### Builds
- `npm run build` → ✅ 0 TS errors, 24 routes (standalone)
- `npm run build:tauri` → ✅ 16 static pages in `out/`
- `npm test` → ✅ 76/76 tests pass
- `tauri build --bundles app` → ✅ `.app` produced

### Tauri architecture (Phase B — no sidecar)
- Window opens instantly (no Node.js sidecar boot)
- LLM calls: browser-side via `src/lib/llm-browser.ts`
- PDF/DOCX parsing: `pdfjs-dist` WASM + mammoth browser build (`document-browser.ts`)
- DB: `@tauri-apps/plugin-sql` SQLite at `~/Library/Application Support/me.saqr.handai/handai.db`
- History detail: inline at `/history?id=uuid` (no dynamic route in static export)
- Local model detection: direct browser fetch to localhost:11434/1234 (no CORS in desktop WebView)
- CSV export: native OS save dialog via `save_file` Rust command

### Web deployment
- All 10 API routes unchanged and working; `/history/[id]` dynamic route unchanged
- Standalone output for server/Docker deployment

---

## Open Issues

1. **CORS for Anthropic/Google in Tauri production** — LLM calls go directly from WKWebView to provider APIs. Anthropic and Google may block requests without `Origin: tauri://localhost` in their CORS allowlist. Not yet verified in production build (only tested in dev mode which uses the Next.js server). Fix if blocked: add `tauri-plugin-http` for those providers only.

2. **pdfjs worker in static export** — `new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url)` relies on webpack asset resolution. Verify the worker file is copied to `out/_next/static/` in a production `tauri build`. Not yet tested end-to-end with a real PDF in production mode.

3. **GitHub Actions CI** — No automated Tauri builds. macOS target requires a macOS runner and code signing setup.

---

## Next Steps (Prioritized)

1. **CORS check** — Run `tauri build`, open the `.app`, test Anthropic and Google providers with a real API key. If blocked, add `tauri-plugin-http` for those two providers.
2. **pdfjs verification** — In the production `.app`, upload a PDF in Process Documents and confirm extraction works.
3. **GitHub Actions** — CI pipeline for Tauri builds (macOS runner, no signing required for CI artifacts).

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
npm run build          → web standalone (.next/standalone/)
npm run build:tauri    → static export (out/) for Tauri
npm run tauri dev      → run from web/desktop/tauri/ (points at Next.js dev server)
tauri build            → run from web/desktop/tauri/ (uses out/ static export)

# Git
web/ remote: https://github.com/mohsaqr/handai_refactored.git branch main
All git commands must run from web/ (separate repo from root)
```
