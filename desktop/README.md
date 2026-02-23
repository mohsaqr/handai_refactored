# Handai Desktop — Build and Installation Guide

Handai Desktop is a native desktop application built with **Tauri 2**, wrapping the Handai Next.js web app. This is the **Phase B architecture**: no Node.js sidecar, instant startup, approximately 10 MB total bundle size.

---

## Architecture Overview

### Phase B design principles

- **No Node.js sidecar** — the app binary contains only Rust + system WebView. Node.js is not bundled and is not required at runtime.
- **Browser-side LLM calls** — LLM requests are made directly from the WebView to provider APIs (OpenAI, Anthropic, Ollama, etc.) using standard browser `fetch`. No server process needed.
- **SQLite via Tauri plugin** — `tauri-plugin-sql` gives the WebView access to a native SQLite database without Prisma or any Node.js ORM.
- **PDF and DOCX extraction in-browser** — `pdfjs-dist` (WASM) and `mammoth` browser build handle document parsing entirely client-side.
- **Native OS dialogs** — CSV export uses `tauri-plugin-dialog` for a native save-file dialog, because WKWebView (the macOS system WebView) silently ignores the HTML `download` attribute.

### Directory layout

```
web/                                ← Next.js 16 app root (web-deployable as-is)
  src/
    lib/
      llm-browser.ts                ← browser-side LLM functions (Tauri path)
      db-tauri.ts                   ← Tauri SQLite DB helpers
      document-browser.ts           ← browser-side PDF/DOCX extraction
  out/                              ← static export (produced by npm run build:tauri)
  desktop/
    tauri/
      package.json                  ← { "scripts": { "tauri": "tauri" } }
      node_modules/
      src-tauri/
        tauri.conf.json             ← Tauri configuration
        Cargo.toml                  ← Rust dependencies
        src/
          main.rs                   ← Rust entry point + SQLite migrations
        capabilities/
          default.json              ← Plugin permissions
        icons/                      ← App icons (auto-generated from icon.png)
        target/                     ← Build output (gitignored, ~1–3 GB)
```

### Compatibility layer

Every tool page detects the runtime environment at startup:

```typescript
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
```

| `isTauri` | LLM calls | Database | File export |
|---|---|---|---|
| `true` | `src/lib/llm-browser.ts` (direct fetch) | `src/lib/db-tauri.ts` (plugin-sql) | Native OS dialog |
| `false` | `/api/*` Next.js API routes | Prisma + SQLite (server-side) | Browser download |

The same TypeScript code runs in both environments — no duplicated logic, no diverging code paths.

---

## Prerequisites

Install all prerequisites before running any build commands. Missing system libraries will cause cryptic Rust compile errors.

### Node.js 20+ and npm 10+

```bash
node --version   # must be >= 20
npm --version    # must be >= 10
```

If your system Node.js is older, install the latest LTS via [nvm](https://github.com/nvm-sh/nvm) or the [official installer](https://nodejs.org).

### Rust (stable toolchain)

Tauri requires the Rust stable toolchain. Install via `rustup`:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustup update stable
rustc --version   # e.g. rustc 1.77.0 or later
```

If you already have Rust installed, make sure it is up to date:

```bash
rustup update stable
```

### macOS system dependencies

Install Xcode Command Line Tools (provides `clang`, `make`, and other build tools):

```bash
xcode-select --install
```

If the command reports the tools are already installed, you are ready to proceed.

### Linux system dependencies

#### Ubuntu / Debian

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libssl-dev \
  pkg-config \
  build-essential \
  curl \
  wget
```

#### Fedora / RHEL / Rocky Linux

```bash
sudo dnf install -y \
  webkit2gtk4.1-devel \
  openssl-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel
```

#### Arch Linux

```bash
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  libappindicator-gtk3 \
  librsvg \
  base-devel \
  openssl
```

### Windows system dependencies

1. **Visual Studio Build Tools** — download from [visualstudio.microsoft.com/visual-cpp-build-tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/). During setup, select the **Desktop development with C++** workload. Visual Studio 2022 (Community or higher) also works.

2. **WebView2 runtime** — ships pre-installed with Windows 10 version 1803 and later, and all editions of Windows 11. If you are on an older version, download the runtime from [developer.microsoft.com/microsoft-edge/webview2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

---

## Installation

### Clone the repository

```bash
git clone https://github.com/mohsaqr/handai_refactored.git
cd handai_refactored/web
```

### Install web app dependencies

```bash
# From web/
npm install
```

### Install Tauri CLI dependencies

```bash
cd desktop/tauri
npm install
```

This installs the `@tauri-apps/cli` package that provides the `tauri` command used in all subsequent steps.

---

## Running in Development Mode

Development mode points the Tauri window at a live Next.js dev server, giving you full hot reload for both the web app and Rust code changes.

```bash
# From web/desktop/tauri/
npm run tauri dev
```

This single command automatically:

1. Starts the Next.js dev server (`cd ../.. && npm run dev`) on `http://127.0.0.1:3000`
2. Compiles the Rust code (first time: approximately 60 seconds; subsequent runs: approximately 5–10 seconds with incremental compilation)
3. Opens the Tauri window pointed at the dev server

**Note on dev mode behavior:** In dev mode, the app uses the Next.js API routes (`/api/*`) for LLM calls rather than the browser-side `llm-browser.ts` path. This is because the dev server provides a full Next.js runtime including server-side routes. The `isTauri` flag is still `true`, so all Tauri-specific features work normally: native CSV save dialog, window state persistence, and SQLite access via `tauri-plugin-sql`.

**First run is slow.** Cargo (Rust's build tool) downloads and compiles all dependencies on the first run. This can take 60–120 seconds depending on your machine and internet connection. All subsequent runs use incremental compilation and are much faster.

---

## Production Build

### Build command

```bash
# From web/desktop/tauri/
npm run tauri build
```

This command runs the following steps automatically:

1. Runs `npm run build:tauri` from `web/` — performs a static Next.js export (`output: 'export'`) into `web/out/`
2. Compiles the Rust binary in release mode (approximately 2 minutes on first build, faster with cached artifacts)
3. Bundles the static assets from `web/out/` into the app binary
4. Produces platform-specific installer packages

### Output locations

After a successful build, find your platform's package here:

```
src-tauri/target/release/handai                     ← raw executable binary

src-tauri/target/release/bundle/
  macos/
    Handai.app                                       ← macOS app bundle
    Handai_0.1.0_aarch64.dmg                        ← macOS disk image installer
  deb/
    handai_0.1.0_amd64.deb                          ← Linux Debian package
  appimage/
    handai_0.1.0_amd64.AppImage                     ← Linux portable AppImage
  msi/
    Handai_0.1.0_x64_en-US.msi                      ← Windows MSI installer
  nsis/
    Handai_0.1.0_x64-setup.exe                      ← Windows NSIS installer
```

### Building specific package types

To build a specific package type and skip others, use the `--bundles` flag:

```bash
npm run tauri build -- --bundles app        # macOS: .app bundle only (no DMG)
npm run tauri build -- --bundles dmg        # macOS: DMG disk image (requires signing)
npm run tauri build -- --bundles deb        # Linux: .deb package
npm run tauri build -- --bundles appimage   # Linux: portable AppImage
npm run tauri build -- --bundles msi        # Windows: MSI installer
npm run tauri build -- --bundles nsis       # Windows: NSIS installer
```

---

## Code Signing (macOS)

Building the `.app` bundle works without any Apple Developer account. However, creating a distributable `.dmg` that macOS Gatekeeper accepts requires a valid Apple Developer ID certificate.

### Without code signing (development / internal use)

Skip the DMG and build just the `.app` bundle:

```bash
npm run tauri build -- --bundles app
```

The resulting `Handai.app` can be copied to `/Applications` and launched directly. macOS will warn that the app is from an unidentified developer the first time; right-click the app and select **Open** to bypass the warning.

### With code signing (distribution)

Set the following environment variables before running the build:

```bash
export APPLE_CERTIFICATE="<base64-encoded .p12 certificate>"
export APPLE_CERTIFICATE_PASSWORD="<certificate password>"
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="your@appleid.com"
export APPLE_PASSWORD="<app-specific password>"
export APPLE_TEAM_ID="<10-character team ID>"
```

Then run the full build:

```bash
npm run tauri build
```

For a complete guide to obtaining certificates, enabling notarization, and setting up CI/CD signing, refer to the [Tauri code signing documentation](https://tauri.app/distribute/sign/macos/).

---

## Tauri Plugins

The following Tauri plugins are included in this build. Each requires both a Rust crate entry in `Cargo.toml` and initialization in `src/main.rs`.

| Plugin | Rust crate (`Cargo.toml`) | npm package | Purpose |
|---|---|---|---|
| `tauri-plugin-sql` | `tauri-plugin-sql = { version = "2", features = ["sqlite"] }` | `@tauri-apps/plugin-sql` | SQLite database (replaces Prisma + Node.js) |
| `tauri-plugin-window-state` | `tauri-plugin-window-state = "2"` | (Rust only) | Persist and restore window size and position across launches |
| `tauri-plugin-dialog` | `tauri-plugin-dialog = "2"` | (Rust only) | Native OS save-file dialog for CSV export |

Plugin permissions are declared in `src-tauri/capabilities/default.json`. If you add a new plugin, its permissions must be listed there or Tauri's security sandbox will block the call at runtime.

---

## Database

The SQLite database is created automatically on first launch. No manual setup or migration commands are needed.

### Database file locations

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/me.saqr.handai/handai.db` |
| Linux | `~/.config/me.saqr.handai/handai.db` |
| Windows | `%APPDATA%\me.saqr.handai\handai.db` |

### Schema management

Table creation and migrations are handled in `src-tauri/src/main.rs`. On every app launch, the Rust code runs the migration SQL against the database. If the tables already exist, the statements are no-ops. To add a new table or column, append a migration to `main.rs`.

---

## Bundle Size

One of the primary goals of Phase B is a small, fast-loading binary. Here is how Handai compares to an Electron app:

| Component | Handai (Tauri Phase B) | Typical Electron App |
|---|---|---|
| Rust binary + Tauri runtime | ~5 MB | — |
| Web assets (Next.js static export) | ~4 MB | ~4 MB |
| System WebView | 0 (uses OS WebView) | ~80 MB (bundled Chromium) |
| Node.js | 0 (eliminated) | ~20 MB (bundled Node) |
| **Total installer size** | **~10 MB** | **~160 MB** |

Tauri uses the operating system's built-in WebView (WKWebView on macOS, WebKitGTK on Linux, WebView2 on Windows), which means zero additional browser engine weight.

---

## Keeping Web Deployment Working

The Tauri build and the standard web deployment are fully independent. Building for Tauri does not affect the web-deployable build and vice versa.

The key difference is the Next.js `output` mode:

| Target | `output` mode | Produced by |
|---|---|---|
| Web deployment | `standalone` | `npm run build` |
| Tauri desktop | `export` (static) | `npm run build:tauri` |

The `TAURI_BUILD=1` environment variable signals `next.config.ts` to switch to `output: 'export'` mode for static file generation.

### Web deployment (unchanged)

```bash
cd web
npm run build    # produces .next/standalone/
npm start
```

For Docker:

```dockerfile
FROM node:22-alpine
COPY web/.next/standalone ./
COPY web/.next/static ./.next/static
COPY web/public ./public
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
```

### Tauri desktop build

```bash
# Step 1: generate static export
cd web
npm run build:tauri   # produces web/out/

# Step 2: build the desktop app
cd desktop/tauri
npm run tauri build
```

---

## Troubleshooting

### "Unable to find web assets" at startup

The Tauri app cannot find the static web files. Run the static export first:

```bash
cd web
npm run build:tauri
```

When running `npm run tauri build` the export step runs automatically. This error only appears if you try to run the binary directly without going through the build command.

### Rust compile errors about missing features or crate versions

Your Rust toolchain is likely out of date:

```bash
rustup update stable
```

Then retry the build.

### Linux: `webkit2gtk not found` or `pkg-config` errors

Install the system libraries for your distribution. See the **Linux system dependencies** section above. The exact package names differ between Ubuntu, Fedora, and Arch.

After installing, verify that `pkg-config` can locate the library:

```bash
pkg-config --libs webkit2gtk-4.1
```

If this returns a list of linker flags, the library is correctly installed.

### macOS: `xcrun: error: invalid active developer path`

The Xcode Command Line Tools are missing or broken:

```bash
xcode-select --install
```

If the tools are installed but the error persists, reset the path:

```bash
sudo xcode-select --reset
```

### First `tauri dev` run takes a very long time

This is expected. Cargo downloads and compiles all Rust dependencies from source on the first run. On a typical machine this takes 60–120 seconds. Subsequent runs use incremental compilation and take 5–10 seconds.

### Dev mode LLM calls are failing

Ensure the Next.js dev server started successfully before the Tauri window loaded. The `beforeDevCommand` in `tauri.conf.json` handles this automatically by waiting for port 3000 to be available. If you see LLM errors:

1. Check that `npm run dev` is not already running on port 3000 in another terminal (the `beforeDevCommand` would conflict).
2. Check that no firewall or security tool is blocking `127.0.0.1:3000`.

### macOS Gatekeeper blocks the app after building without signing

Right-click `Handai.app` in Finder and select **Open**. macOS will ask for confirmation and then allow the app to run. After the first launch, you can open the app normally by double-clicking. Alternatively, remove the quarantine attribute from the terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Handai.app
```

### Windows: app fails to start with WebView2 error

WebView2 ships with Windows 10 1803+ and Windows 11. If you are on an older Windows version or a stripped-down server image, install the WebView2 runtime manually from [developer.microsoft.com/microsoft-edge/webview2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

### Build output directory is very large

The `src-tauri/target/` directory accumulates compiled Rust artifacts and can reach 1–3 GB. This is normal. To free disk space, delete the directory and rebuild from scratch:

```bash
rm -rf web/desktop/tauri/src-tauri/target/
```

The next build will recompile everything, taking approximately the same time as the first build.

---

## Quick Reference

```bash
# Install everything (run once after cloning)
cd web && npm install
cd desktop/tauri && npm install

# Development mode (hot reload)
cd web/desktop/tauri && npm run tauri dev

# Production build
cd web/desktop/tauri && npm run tauri build

# Static export only (without building the binary)
cd web && npm run build:tauri

# Build specific package type
cd web/desktop/tauri && npm run tauri build -- --bundles app       # macOS .app
cd web/desktop/tauri && npm run tauri build -- --bundles appimage  # Linux AppImage
cd web/desktop/tauri && npm run tauri build -- --bundles msi       # Windows MSI

# Web deployment (unaffected by Tauri)
cd web && npm run build && npm start

# Update Rust toolchain
rustup update stable
```
