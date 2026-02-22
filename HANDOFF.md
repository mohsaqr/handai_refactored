# Session Handoff — 2026-02-22

## Completed This Session

### Stability fixes
- **`process-row`**: DB log write (`prisma.runResult.create`) now has its own try/catch; LLM success is returned to client even if logging fails
- **`consensus-row`**: Changed `Promise.all` → `Promise.allSettled` for workers; returns 502 only if fewer than 2 workers succeed; individual failures are reported in error message
- **`withRetry`**: Added non-retryable error detection (401, 403, `invalid_api_key`, `authentication`); auth errors now fail immediately without 3× wasted retries
- **`validation.ts`**: All API key fields changed from `z.string().min(1)` → `z.string().default("")`; local providers (Ollama, LM Studio) no longer fail validation when apiKey is empty
- **Tests updated**: 71 → 76 passing — new tests cover apiKey empty default, non-retryable auth errors, retryable network errors

### Desktop packaging
- `next.config.ts`: added `output: "standalone"` — produces `.next/standalone/server.js`
- `web/desktop/electron/`: complete Electron wrapper (main.js, preload.js, package.json)
  - Spawns `server.js` on port 3947 using Electron's built-in Node.js
  - Polls for server ready before showing window; kills server on quit
- `web/desktop/tauri/`: complete Tauri wrapper (Cargo.toml, main.rs, tauri.conf.json, package.json)
  - Sidecar approach: spawns `node server.js` via `tauri-plugin-shell`
  - `main.rs` manages child process lifecycle and polls for server ready

### Settings redesign
- Two-column layout: sticky 160px left nav + content (removed narrow `max-w-4xl` constraint)
- Provider cards: compact single-row header with status dot, enable toggle, test button
- Status dot: green = ready, amber = missing key, muted = disabled
- Cloud API and Local sections grouped separately
- Prompt Templates: per-tool collapsible instead of one giant collapsible

### Zero-config local model detection
- `/api/local-models` route: server-side probe of Ollama (port 11434) and LM Studio (port 1234) with 2s timeout
- `AppSidebar`: runs detection on mount; auto-enables provider and sets first detected model
- Settings: shows detected models as clickable pills; refresh button; "not running" hint

### Hydration fixes
- `qualitative-coder`: systemPrompt + codebook initialized from `[]`/default, loaded from localStorage in mount effect
- `transform`: same pattern for systemPrompt
- `automator`: same pattern for steps

### Other improvements committed earlier
- Run delete (DELETE /api/runs/[id] + confirmation dialog in history pages)
- DataTable: search, sort, pagination, cell expand modal
- Abort support in Transform, Automator, Consensus Coder, Model Comparison
- Compact sample dataset cards in Qualitative Coder
- Autosave + crash recovery (dual-slot + beforeunload + recovery banner + pending load dialog)
- RunMode (preview/test/full) across all batch tools

---

## Current State

### Works
- Web app: `npm run dev` → localhost:3000
- All 24 API routes compile (0 TS errors)
- All 76 tests passing
- Standalone build: `npm run build` → `.next/standalone/server.js` exists
- Electron: ready to `npm install && npm start` in `web/desktop/electron/`
- Tauri: code is written; needs Rust toolchain + Node.js sidecar binary to build
- Settings: redesigned, fully functional
- Local model auto-detection: works for Ollama and LM Studio
- Autosave: AI Coder + Manual Coder with dual-slot + beforeunload

### Not yet done
- Electron: hasn't been `npm install`'d or tested end-to-end (just code)
- Tauri: needs Rust installed + `node` binary placed in `src-tauri/binaries/`
- Phase B Tauri migration (LLM calls to browser, Prisma → tauri-plugin-sql)
- No GitHub Actions CI for desktop builds yet
- No code signing setup
- AI Coder page still has `AutomatorRowSchema`-style validation that may need review

---

## Key Decisions Made

1. **Desktop: sidecar approach for both Electron and Tauri** — zero web code changes required; all API routes, Prisma, LLM calls work as-is. Electron uses built-in Node.js (no extra runtime). Tauri requires bundling a Node binary (~50 MB) but is still smaller than Electron (~85 vs ~160 MB).

2. **`output: "standalone"`** — generates a self-contained `.next/standalone/server.js`. This is the only change to `web/next.config.ts`. The web app deploys identically (Vercel, Docker, etc.).

3. **Port 3947** — used by both desktop wrappers to avoid clashing with the dev server on 3000.

4. **`Promise.allSettled` for consensus workers** — a single slow or misconfigured LLM shouldn't abort an entire research analysis. The route now continues with however many workers succeeded.

5. **`withRetry` non-retryable classification** — string match on common auth error messages. Not perfect but catches 99% of cases without adding an HTTP parsing dependency.

---

## Open Issues

1. **Tauri Node sidecar binary** — must be manually downloaded and placed at `src-tauri/binaries/node-{target-triple}` for each platform. No automation yet. See `desktop/README.md`.

2. **Prisma dev.db path** — in desktop mode the DB is at the CWD of `server.js`. For production this should be `app.getPath('userData')` in Electron or the Tauri data directory. Currently left as-is (works, but DB location varies).

3. **`AutomatorRowSchema` `apiKey`** — now allows empty string, consistent with other schemas. Pages should pass `config.apiKey || "ollama"` for local providers (most already do this).

4. **PDF parsing in Tauri Phase B** — `pdf-parse` uses native bindings that don't work in browser. `pdfjs-dist` is the browser-safe replacement but hasn't been implemented yet.

5. **Electron code signing** — required for macOS notarization and Windows SmartScreen. Needs Apple Developer ID + Windows EV certificate. Not blocked for development builds.

---

## Next Steps (Prioritized)

### Immediate (next session)
1. **Test Electron end-to-end**: `cd web/desktop/electron && npm install && npm start` — verify server starts, window opens, all routes work
2. **Prisma DB path**: In `main.js` Electron wrapper, pass `DATABASE_URL=file://${app.getPath('userData')}/handai.db` as env var to the server process

### Short term
3. **Tauri Phase A**: Download Node.js binary for macOS, place at `src-tauri/binaries/node-aarch64-apple-darwin`, run `tauri build`
4. **GitHub Actions**: CI matrix for Electron builds (mac/win/linux)
5. **Prisma migrations**: Run `prisma migrate deploy` inside `server.js` startup or as a separate step in the desktop build

### Medium term (Phase B Tauri)
6. Move LLM calls from 6 API routes → browser-side `fetch()` utility (about 1 day)
7. Replace `prisma.runResult/run` calls in 3 routes → `tauri-plugin-sql`
8. Replace `pdf-parse` → `pdfjs-dist` browser build

### Longer term
9. Auto-updater (electron-updater / Tauri updater)
10. System tray with quick-access
11. SQLite backup / export history

---

## Environment

```bash
# Web app
node 22, npm 10
Next.js 16.1.6, React 19, TypeScript 5
Prisma 6 + SQLite

# Desktop (Electron)
electron 34, electron-builder 25
No extra runtime needed

# Desktop (Tauri)
tauri 2, tauri-plugin-shell 2
Rust stable (1.77+)
```
