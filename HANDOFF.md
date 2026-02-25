# Session Handoff — 2026-02-25

## Completed This Session

### Abstract Screener module (new tool)
- `src/lib/ris-parser.ts` — NEW: parses `.ris` bibliographic files into `Row[]`. Handles multi-value tags (AU, KW), skips empty records, maps TI/T1/AB/KW/JO/JF/T2/PY/Y1/AU/DO to standard field names.
- `src/components/tools/FileUploader.tsx` — Added `.ris` file support: import `parseRis`, handle `fileExt === "ris"` branch with `readAsText`, added RIS MIME types to dropzone accept list, updated display text.
- `src/lib/prompts.ts` — Added `screener.default` prompt (category: `screener`) with `{criteria}` placeholder substituted at call time.
- `src/lib/sample-data.ts` — Added `systematic_review` sample dataset: 10 mixed abstracts (RCTs, meta-analyses, animal study, non-English, cohort study, pharmacokinetics) useful for testing batch screener and keyword highlighting.
- `src/components/AppSidebar.tsx` — Added `FlaskConical` icon import and `Abstract Screener` nav item to the Qualitative Analysis group.
- `src/app/abstract-screener/page.tsx` — NEW: full screener page (380+ lines). Three screens: config/load → batch progress → screening interface with abstract display, keyword highlighting, AI badge, decision buttons, session bar, analytics, table panel, navigation, autosave.
- `src/lib/__tests__/prompts.test.ts` — Updated count 15→16, added `screener.default` to expectedIds, added `screener` category test.

---

## Current State

### Builds
- `npm run build` → ✅ 0 TS errors, 26 routes (was 24; +abstract-screener, +history/[id] counting)
- `npm run build:tauri` → ✅ 15 static pages in `out/` (abstract-screener included)
- `npm test` → ✅ 77/77 tests pass (was 76; +1 screener category test)

### Abstract Screener architecture
- **No new API routes** — reuses `/api/process-row` (web) and `processRowDirect` (Tauri)
- **Three screens**: Screen 1 (no data), Screen 2 (isBatching), Screen 3 (review interface)
- **Config panel** shown when `aiCount === 0 && !skipConfigPanel` — visible first time, hidden after batch runs or user clicks "Skip AI (manual)"
- **Autosave**: dual-slot (`as_autosave` / `as_autosave_prev`), exact pattern from AI Coder
- **Sessions**: `as_named_sessions` localStorage, save/load/delete
- **CSV export**: two modes via `downloadCSV()` — Full (all cols + ai_decision + ai_reasoning + final_decision) and Decisions Only (title/journal/year/final_decision)
- **Keyboard shortcuts**: ← → / h/l navigate, y=include, n=exclude, m=maybe
- **RIS auto-colmap**: fields named `title`/`abstract`/`keywords`/`journal` are auto-detected; user can override via dropdowns in config panel
- **AI highlight terms**: words from `highlight_terms` JSON field wrapped in `<mark className="bg-amber-200 dark:bg-amber-800 ...">` via React split pattern (no dangerouslySetInnerHTML)

---

## Open Issues

1. **CORS for Anthropic/Google in Tauri production** (from previous session, still unverified)
2. **pdfjs worker in static export** (from previous session, still unverified)
3. **Abstract Screener: no concurrency control** — batch runs sequentially (for-loop). Could add `pLimit` concurrency like AI Coder's batch mode, but sequential is simpler for systematic review screening (fewer rate-limit risks).
4. **RIS: non-standard encodings** — some RIS files exported from EndNote use Windows-1252. FileReader defaults to UTF-8. Could add charset sniffing but not needed for launch.

---

## Next Steps (Prioritized)

1. **Manual test the screener** — upload a real `.ris` file exported from a reference manager; verify columns auto-map correctly; run AI pre-screen on sample_review data; check keyword highlighting in abstract.
2. **CORS check in Tauri production** — run `tauri build`, test Anthropic/Google providers.
3. **pdfjs verification** — test PDF upload in production `.app`.
4. **Settings page: add screener prompt** — the Settings page shows prompts grouped by category; `screener.default` will appear automatically since it's registered in PROMPTS with category `"screener"`.

---

## Environment

```bash
# Web app
node 22, npm 10
Next.js 16.1.6, React 19, TypeScript strict
Tailwind v4, shadcn/ui
Prisma 6 + SQLite (web deployment only)
Vitest (77 tests)

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
