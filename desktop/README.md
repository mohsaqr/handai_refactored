# Handai — Desktop Packaging

Two independent wrappers for the Next.js web app. The web app itself (`web/`) is unchanged and deploys normally as a web app. These wrappers only add a desktop shell.

## Architecture

```
web/                          ← Next.js app (web-deployable as-is)
  .next/standalone/           ← built output (npm run build)
    server.js                 ← self-contained Node.js server
    node_modules/             ← minimal deps only
web/desktop/
  electron/                   ← Electron wrapper (spawns server.js)
  tauri/                      ← Tauri wrapper (sidecar approach)
```

Both wrappers use the **same strategy**:
1. `npm run build` in `web/` → produces `.next/standalone/server.js`
2. Desktop app spawns `node server.js` on port 3947
3. Native window loads `http://127.0.0.1:3947`
4. All 10 API routes, Prisma/SQLite, and LLM calls work unchanged

---

## Electron

### Prerequisites
```bash
node >= 20
npm >= 10
```

### Dev (no packaging)
```bash
# 1. Build the web app (needed once; re-run after web changes)
cd web && npm run build && cd ..

# 2. Run Electron pointing at the standalone build
cd web/desktop/electron
npm install
npm start
```

### Package
```bash
cd web/desktop/electron
npm run build          # builds web + packages Electron app
# Output: web/desktop/electron/dist/
```

### How it works
`main.js` spawns `process.execPath` (the bundled Node.js in Electron) with `server.js`. This means:
- **No separate Node.js installation required** — Electron bundles Node.js
- Polls `http://127.0.0.1:3947` every 300ms (max 15s) before showing the window
- Kills the server process cleanly on `before-quit`
- External links open in the system browser

### Bundle contents
| Component | Size |
|---|---|
| Electron shell + Chromium | ~130 MB |
| Next.js standalone server | ~25 MB |
| `.next/static` (CSS/JS assets) | ~5 MB |
| **Total** | **~160 MB** |

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
| `tauri-plugin-shell` | Spawn Node.js sidecar (production only) |
| `tauri-plugin-window-state` | Persist window size/position across launches |
| `tauri-plugin-dialog` | Native OS save-file dialog for CSV export |

> **Why a native dialog for CSV?** WKWebView (macOS system WebView) does not support the HTML `download` attribute. Blob URL + anchor-click silently fails. The web app detects Tauri via `window.__TAURI_INTERNALS__` and invokes the `save_file` command instead.

### Phase A — Sidecar (current, zero web code changes)

The Tauri app bundles a Node.js binary as an `externalBin` sidecar and spawns the Next.js server on startup.

**Step 1: Obtain a Node.js binary for each platform**
```bash
# macOS arm64 example — adapt for your CI matrix
NODE_VERSION=22.0.0
curl -L "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz" | tar xz
mkdir -p web/desktop/tauri/src-tauri/binaries
cp node-v${NODE_VERSION}-darwin-arm64/bin/node \
   web/desktop/tauri/src-tauri/binaries/node-aarch64-apple-darwin
```
> Tauri requires platform-suffixed binary names. See [Tauri sidecar docs](https://tauri.app/develop/sidecar/).

**Step 2: Build**
```bash
cd web && npm run build && cd ..
cd web/desktop/tauri
npm install
npm run build          # calls `tauri build`
```

### Phase B — Full migration (future, smaller bundle ~15 MB)

See `ARCHITECTURE.md` for the complete migration plan. Summary:
- Move LLM calls from API routes → browser `fetch()` directly to LLM providers
- Replace Prisma → `tauri-plugin-sql` (SQLite via Rust)
- Replace `pdf-parse` → `pdfjs-dist` (WASM, browser-native)
- Result: no sidecar needed, bundle shrinks to ~15 MB, instant startup

### Bundle size comparison

| | Electron | Tauri (Phase A) | Tauri (Phase B) |
|---|---|---|---|
| Shell | 130 MB (Chromium) | 5 MB (system WebView) | 5 MB |
| Node.js sidecar | 0 (built-in) | ~50 MB bundled | 0 |
| App code | ~30 MB | ~30 MB | ~5 MB |
| **Total** | **~160 MB** | **~85 MB** | **~10 MB** |

---

## CI Matrix (GitHub Actions)

```yaml
jobs:
  desktop:
    strategy:
      matrix:
        include:
          - os: macos-14        # arm64
          - os: macos-13        # x64
          - os: windows-latest
          - os: ubuntu-22.04
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Build web
        run: cd web && npm ci && npm run build
      - name: Package Electron
        run: cd web/desktop/electron && npm ci && npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: handai-${{ matrix.os }}
          path: web/desktop/electron/dist/**
```

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

The only change to `web/` for desktop support was adding `output: "standalone"` to `next.config.ts`. This has zero impact on web deployment.
