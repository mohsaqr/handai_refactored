# Handai — Desktop Packaging

Tauri wrapper for the Handai Next.js web app. Phase B: no Node.js sidecar, browser-side LLM calls, SQLite via `tauri-plugin-sql`, ~10 MB bundle.

## Architecture

```
web/                          ← Next.js app (web-deployable as-is)
  out/                        ← static export (npm run build:tauri)
web/desktop/
  tauri/                      ← Tauri wrapper (browser-side LLM + SQL)
```

### Compatibility layer

Pages detect `__TAURI_INTERNALS__` at runtime:
- **Tauri path**: LLM calls go direct from browser via `src/lib/llm-browser.ts`; DB via `src/lib/db-tauri.ts` (`@tauri-apps/plugin-sql`)
- **Web path**: existing `/api/*` routes unchanged — web deployment fully working

---

## Tauri

### Prerequisites
```bash
node >= 20
rustup (stable toolchain)
# macOS: Xcode command line tools
# Linux: webkit2gtk-4.1, libappindicator3
# Windows: WebView2 (ships with Windows 10+)
```

### Tauri plugins
| Plugin | Purpose |
|---|---|
| `tauri-plugin-sql` | SQLite database (replaces Prisma/Node.js) |
| `tauri-plugin-window-state` | Persist window size/position across launches |
| `tauri-plugin-dialog` | Native OS save-file dialog for CSV export |

> **Why a native dialog for CSV?** WKWebView (macOS system WebView) does not support the HTML `download` attribute. Blob URL + anchor-click silently fails. The web app detects Tauri via `window.__TAURI_INTERNALS__` and invokes the `save_file` command instead.

### Dev (instant window, no sidecar)
```bash
# Terminal 1: run the Next.js dev server
cd web && npm run dev

# Terminal 2: open Tauri window pointing at the dev server
cd web/desktop/tauri
npm install
npm run tauri dev
```

### Production build (static export)
```bash
# 1. Build web app as static export
cd web && npm run build:tauri   # produces web/out/

# 2. Build Tauri app
cd web/desktop/tauri
npm run tauri build
```

### Bundle size comparison

| | Tauri (Phase B) |
|---|---|
| Shell (system WebView) | ~5 MB |
| Node.js sidecar | 0 (eliminated) |
| App code | ~5 MB |
| **Total** | **~10 MB** |

---

## Keeping web app deployable

The `web/` directory remains a standard Next.js app. You can deploy it anywhere:

```bash
# Vercel / Railway / Fly.io
cd web && npm run build && npm start

# Docker
FROM node:22-alpine
COPY web/.next/standalone ./
COPY web/.next/static ./.next/static
COPY web/public ./public
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
```

The Tauri build uses `output: "export"` (via `TAURI_BUILD=1 next build`), which is separate from the standard web build (`output: "standalone"`).
