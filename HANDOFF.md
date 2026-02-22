# Session Handoff — 2026-02-22

## Completed This Session

### Tauri improvements
- **DB path fix (critical for production)**: `DATABASE_URL` env var now set to `app_data_dir()/handai.db` before spawning sidecar → `~/Library/Application Support/me.saqr.handai/handai.db` on macOS
- **Window state persistence**: Added `tauri-plugin-window-state`; window size/position restored automatically on startup
- **Branded loading screen**: `web-dist/index.html` replaced with dark-indigo splash (CSS spinner, no JS)
- **Native CSV save dialog**: Added `tauri-plugin-dialog` + `save_file` Tauri command; `downloadCSV()` detects Tauri via `__TAURI_INTERNALS__` and shows OS save dialog instead of blob-URL anchor (which WKWebView silently ignores)

### Export consistency
- New `src/lib/export.ts`: shared async `downloadCSV(rows, filename)` — UTF-8 BOM CSV, browser blob OR Tauri native dialog
- Manual Coder: filenames now `{dataName}_coded.csv` / `{dataName}_onehot.csv` (was `coded_data.csv`)
- AI Coder: filenames now `{dataName}_ai_coded.csv` / `_ai_onehot.csv` / `_ai_full.csv`
- Qualitative + Consensus Coder: same export logic, shared util (filenames unchanged)

### Manual Coder UX
- **Coded Table Preview**: Table button → scrollable panel with All/Coded/Uncoded filter pills + click-to-navigate; current row highlighted; closes on row click
- **Session bar repositioned**: moved from top of coding view to below the big Next button and above Export Results — better matches the coding workflow

---

## Current State

### Works
- `npm run dev` → localhost:3000 (all 24 routes)
- `npm run build` → 0 TS errors
- `npm test` → 76/76 tests pass
- Tauri dev mode: `cd web/desktop/tauri && npm run tauri dev` → window opens, all features work including CSV export (native save dialog)
- All CSV exports include data name in filename
- Manual Coder: Table view, session bar in correct position
- Autosave: AI Coder + Manual Coder with dual-slot + recovery banner
- Settings: two-column, all providers, prompt templates

### Not yet done
- Tauri production build (`tauri build`) — untested; needs Node binary sidecar + code signing
- Electron: code written, not end-to-end tested
- Phase B Tauri migration (LLM calls to browser, Prisma → tauri-plugin-sql)
- GitHub Actions CI for desktop builds

### Tauri plugins in use
| Plugin | Purpose |
|---|---|
| `tauri-plugin-shell` | Spawn Node.js sidecar (production only) |
| `tauri-plugin-window-state` | Persist window size/position |
| `tauri-plugin-dialog` | Native save-file dialog for CSV export |

---

## Key Decisions Made

1. **Tauri CSV via native dialog** — WKWebView (macOS system WebView) does not support the HTML `download` attribute. Blob URL anchor clicks silently fail. Solution: detect `window.__TAURI_INTERNALS__` and invoke `save_file` command which calls `blocking_save_file()` from tauri-plugin-dialog. Falls back to blob URL in browser.

2. **`downloadCSV` async** — Making it async allows dynamic import of `@tauri-apps/api/core` only when in Tauri context (no bundle impact in browser build). All callers use `void downloadCSV(...)`.

3. **Session bar placement** — Moved below Next button so the coding flow is uninterrupted: text → codes → Next → then session management + export. Cleaner hierarchy.

4. **Window state auto-restore** — `tauri-plugin-window-state` restores on plugin init; no manual `restore_window_state` call needed (method doesn't exist in Tauri 2 API).

---

## Open Issues

1. **Tauri Node sidecar binary** — must be manually placed at `src-tauri/binaries/node-{target-triple}` per platform. See `desktop/README.md`.
2. **Tauri production DB path** — fixed in code (`DATABASE_URL` → app data dir), but untested until `tauri build` is run.
3. **Electron DB path** — still uses CWD; should pass `DATABASE_URL=file://${app.getPath('userData')}/handai.db`.
4. **Phase B Tauri migration** — no sidecar needed, ~10 MB bundle. See ARCHITECTURE.md for plan.
5. **Electron end-to-end** — code written but never run: `cd web/desktop/electron && npm install && npm start`.
6. **`allowedDevOrigins` warning** — Next.js 16 cross-origin warning from Tauri dev (127.0.0.1 → localhost:3000). Cosmetic only; fix by adding to `next.config.ts`.

---

## Next Steps (Prioritized)

1. **Fix `allowedDevOrigins`** in `next.config.ts` — 1-liner to silence the cross-origin warning in Tauri dev
2. **Test Electron end-to-end** — `cd web/desktop/electron && npm install && npm start`
3. **Electron DB path** — pass `DATABASE_URL` in `main.js` spawn env
4. **Tauri production build** — download Node binary → `tauri build` → verify DB, CSV export, all routes
5. **GitHub Actions** — CI matrix for Electron (mac/win/linux)
6. **Phase B Tauri** — move 6 LLM routes to browser fetch → eliminate sidecar

---

## Environment

```bash
# Web app
node 22, npm 10
Next.js 16.1.6, React 19, TypeScript strict
Tailwind v4, shadcn/ui
Prisma 6 + SQLite
Vitest (76 tests)

# Tauri
Rust stable 1.77+
tauri 2, tauri-plugin-shell 2, tauri-plugin-window-state 2, tauri-plugin-dialog 2
@tauri-apps/api (installed in web/)

# Git
web/ remote: https://github.com/mohsaqr/handai_refactored.git branch main
All commits from web/ directory only
```
