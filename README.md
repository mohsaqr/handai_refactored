# Handai AI Data Suite — Web App (JavaScript)

A qualitative and quantitative data analysis suite powered by large language models. Runs as a web app or as a native desktop application (Tauri, ~10 MB) — no code changes between the two targets.

Built with Next.js 16, React 19, TypeScript, and Tailwind CSS v4.

---

## Two Versions of Handai

Handai ships in two completely independent versions that share the same tools and LLM providers but are built on different technology stacks. **This repository is the JavaScript/Next.js version.**

| | **Handai Web** (this repo) | **Handai Streamlit** |
|---|---|---|
| **Stack** | Next.js 16, React 19, TypeScript | Python, Streamlit |
| **Repo** | [mohsaqr/handai_refactored](https://github.com/mohsaqr/handai_refactored) | [mohsaqr/handai](https://github.com/mohsaqr/handai) |
| **Run** | `npm install && npm run dev` → :3000 | `pip install -r requirements.txt && streamlit run app.py` → :8501 |
| **Desktop app** | Tauri (~10 MB native, instant launch) | Electron wrapper |
| **Run history** | SQLite DB, History page, per-row drill-down | — |
| **Web deploy** | Vercel / Docker / any Node host | — |
| **Best for** | Teams, web deployment, production, non-Python users | Python users, quick local analysis |
| **Tools** | All 11 tools | All 11 tools |
| **Providers** | All 10 providers | All 10 providers |

**Choose Handai Web if you** want to deploy it for a team, want the Tauri desktop app, prefer TypeScript/React, or need run history and CSV export from past sessions.

**Choose Handai Streamlit if you** are already in the Python ecosystem, want the simplest possible local setup, or prefer Streamlit's single-file script approach.

Both versions are fully independent — you do not need to install or run both.

---

## Table of Contents

- [What is Handai?](#what-is-handai)
- [Tools](#tools)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [First Run Walkthrough](#first-run-walkthrough)
- [Configuration and API Keys](#configuration-and-api-keys)
- [Supported LLM Providers](#supported-llm-providers)
- [Data Format](#data-format)
- [Scripts Reference](#scripts-reference)
- [Web Deployment](#web-deployment)
- [Desktop App (Tauri)](#desktop-app-tauri)
- [Tech Stack](#tech-stack)
- [Project Layout](#project-layout)
- [Architecture](#architecture)

---

## What is Handai?

Handai is a browser-based research toolkit for analysts, qualitative researchers, and data scientists who want to apply LLMs to their data without writing code. You bring a CSV file, pick a tool, choose a model, and run. Results are saved to a local SQLite database and can be exported as CSV at any time.

**Key design principles:**

- **No vendor lock-in.** Switch between OpenAI, Anthropic, Google, Groq, or a locally running Ollama model by changing a dropdown in Settings.
- **Human in the loop.** Tools like Manual Coder and AI Coder are built around review workflows, not fire-and-forget automation.
- **Works offline.** When connected to Ollama or LM Studio, the entire app runs without any internet connection.
- **Portable.** The same codebase produces a Next.js web app and a ~10 MB Tauri native app that opens instantly without a Node.js server.

---

## Tools

| Tool | What it does |
|---|---|
| **Manual Coder** | Keyboard-driven qualitative coding. Arrow keys navigate rows; `0`/`1` buttons (or keyboard shortcuts) apply codes. Full autosave — resume exactly where you left off. |
| **AI Coder** | AI suggests a code for each row; you review and accept, override, or skip. Autosave keeps your progress across sessions. |
| **Qualitative Coder** | Batch-code an entire dataset against a codebook in one run. Each row is scored against every codebook category. Exports results as CSV. |
| **Consensus Coder** | N independent worker models each code every row, then a judge model resolves disagreements. Reports Cohen's κ inter-rater agreement score. |
| **Codebook Generator** | Feed a sample of text rows and let the LLM inductively derive a codebook. Edit and refine before using it in Qualitative Coder. |
| **Transform** | Apply any free-form LLM prompt to every row in a CSV. Useful for translation, summarisation, sentiment, entity extraction, or any custom transformation. |
| **Automator** | Build a multi-step LLM pipeline where each step's output feeds into the next. Chain up to N steps, each with its own prompt and model. |
| **Generate** | Synthesise realistic datasets by providing a schema and a few example rows. Useful for testing or creating training data. |
| **Process Documents** | Upload PDFs, DOCX, or plain-text files. The LLM extracts structured data fields you define. Results exportable as CSV. |
| **Model Comparison** | Run the same prompt across N models side-by-side. Useful for evaluating model suitability before committing to a full batch run. |
| **History** | Browse all previous batch runs. Filter by tool or date, drill into per-row results, and re-export any run as CSV. |
| **Settings** | Configure API keys for each provider, enable or disable providers, and customise the system prompt templates used by each tool. |

---

## Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Node.js | 20 or higher | `node --version` |
| npm | 10 or higher (ships with Node 20) | `npm --version` |
| Git | Any recent version | `git --version` |

For the **desktop app** only: Rust toolchain and Tauri CLI. See [Desktop App (Tauri)](#desktop-app-tauri).

For **local LLM inference**: [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai) installed and running. The app auto-detects them — no configuration required.

---

## Installation

```bash
git clone https://github.com/mohsaqr/handai_refactored.git
cd handai_refactored/web
npm install
```

That is all that is required for local development. No database setup, no environment variables — the app creates its SQLite database automatically on first run.

---

## First Run Walkthrough

This takes about 5 minutes from a fresh clone to running analysis on your own data.

**1. Start the development server**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**2. Add an API key**

Click **Settings** in the left sidebar. Select a provider (for example, OpenAI), paste your API key into the key field, and click **Save**. The status indicator next to the provider turns green.

If you prefer not to use a cloud provider, skip this step and set up Ollama instead (see step 3).

**3. (Optional) Use a local model**

Install [Ollama](https://ollama.com) and run any model:

```bash
ollama run llama3.2
```

Handai detects Ollama automatically when you open the app. No key or configuration needed. The detected model appears as a clickable pill in Settings under the Ollama section.

LM Studio works the same way — start the local server in LM Studio and Handai will find it.

**4. Try a tool with sample data**

Click any tool in the sidebar (for example, **Qualitative Coder**). Click **Load Sample Data** to load a built-in demo dataset. Configure your options and click **Run**. Results appear inline and can be exported as CSV.

**5. Use your own data**

Click the file upload area on any tool page and select a CSV file, or drag and drop it. The tool will show a column selector — pick which column contains the text you want to analyse. Column names and order do not matter.

---

## Configuration and API Keys

API keys are stored in your browser's `localStorage` via the Settings page. They never leave your browser except when making direct calls to provider APIs.

No `.env` file is required for local development or for the desktop app.

If you are deploying the web app to a server and want to pre-configure keys at the server level (so users do not need to enter them), create `web/.env.local`:

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=...
GROQ_API_KEY=...
TOGETHER_AI_API_KEY=...
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
OPENROUTER_API_KEY=...
```

Keys set in `.env.local` act as server-side defaults. Keys entered in the Settings UI take precedence over server-side keys.

---

## Supported LLM Providers

| Provider | Type | Auto-detected | API Key Required |
|---|---|---|---|
| OpenAI | Cloud | No | Yes |
| Anthropic (Claude) | Cloud | No | Yes |
| Google Gemini | Cloud | No | Yes |
| Groq | Cloud | No | Yes |
| Together AI | Cloud | No | Yes |
| Azure OpenAI | Cloud | No | Yes + endpoint |
| OpenRouter | Cloud | No | Yes |
| Ollama | Local | Yes (port 11434) | No |
| LM Studio | Local | Yes (port 1234) | No |
| Custom endpoint | Local/self-hosted | No | Optional |

The **Custom endpoint** option accepts any OpenAI-compatible API (vLLM, text-generation-webui, LocalAI, etc.). Enter the base URL in Settings.

---

## Data Format

Handai accepts any well-formed CSV file:

- Any delimiter (comma, semicolon, tab — detected automatically)
- Any number of columns
- Column names in the first row (required)
- UTF-8 encoding recommended

After uploading, every tool shows a **column selector** dropdown. Pick the column that contains the text you want to process. You can also select multiple columns for tools that support multi-column input (e.g. Automator).

There is no required schema. A CSV with a single column of free-text responses works just as well as a structured dataset with dozens of columns.

---

## Scripts Reference

Run all scripts from the `web/` directory.

```bash
npm run dev          # Start Next.js dev server at http://localhost:3000 with hot reload
npm run build        # Production build — standalone output — 0 TypeScript errors required
npm run build:tauri  # Static export for Tauri desktop — produces web/out/
npm start            # Serve the production build (run npm run build first)
npm test             # Run Vitest test suite — 76 tests across 4 suites
npm run lint         # ESLint check across all source files
```

### Build targets

The project supports two build modes controlled by `next.config.ts`:

| Mode | Command | Output | Used for |
|---|---|---|---|
| Standalone | `npm run build` | `.next/standalone/server.js` | Web deployment, Docker |
| Static export | `npm run build:tauri` | `out/` | Tauri desktop app |

---

## Web Deployment

### Option 1: Node.js server

```bash
npm run build
npm start            # Serves on port 3000
```

Set the `PORT` environment variable to change the port.

### Option 2: Docker

A multi-stage Dockerfile is included in `web/`:

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]
```

Build and run:

```bash
docker build -t handai-web .
docker run -p 3000:3000 handai-web
```

### Option 3: Managed platforms

Handai is a standard Next.js application. Deploy to Vercel, Railway, Fly.io, or any other platform that supports Node.js without any special configuration.

For Vercel:

```bash
npx vercel
```

---

## Desktop App (Tauri)

The Tauri wrapper produces a native app that is approximately 10 MB because it uses the operating system's built-in WebView (WKWebView on macOS, WebView2 on Windows) rather than bundling Chromium.

**Differences from the web app:**

- LLM calls go directly from the WebView to provider APIs — no Next.js API routes involved
- The SQLite database is managed by `tauri-plugin-sql` instead of Prisma
- CSV exports use the native OS save dialog instead of a browser download
- No Node.js process runs at runtime — the app opens instantly
- The static export (`npm run build:tauri`) is served from the app bundle itself

**Quick start (development mode):**

```bash
# Prerequisites: Rust + Tauri CLI
# https://tauri.app/start/prerequisites/

cd web/desktop/tauri
npm install
npm run tauri dev   # Opens a native window pointed at http://localhost:3000
```

This requires the Next.js dev server (`npm run dev`) to be running in a separate terminal.

**Build a distributable app:**

```bash
npm run build:tauri          # from web/ — produces the static export in web/out/
cd web/desktop/tauri
npm run tauri build          # produces .dmg / .msi / .AppImage in src-tauri/target/release/bundle/
```

See [`desktop/README.md`](desktop/README.md) for platform-specific instructions, code-signing notes, and the full build pipeline.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16.1.6 (App Router) | 24 routes, `output: "standalone"` |
| UI library | React 19 | |
| Language | TypeScript (strict mode) | 0 errors required at build time |
| Styling | Tailwind CSS v4, shadcn/ui | |
| LLM SDK | Vercel AI SDK v4 | `generateText`, `withRetry` wrapper |
| Database (web) | Prisma 6 + SQLite | `prisma/dev.db` |
| Database (desktop) | tauri-plugin-sql + SQLite | No Prisma/Node at runtime |
| State management | Zustand | Persisted to `localStorage` as `handai-storage` |
| Testing | Vitest | 76 tests across 4 suites |
| Desktop | Tauri 2 | Plugins: shell, window-state, dialog |

---

## Project Layout

```
web/
├── src/
│   ├── app/
│   │   ├── api/                    ← 10 server-side API routes (web deployment only)
│   │   │   ├── process-row/        ← Core LLM dispatch route
│   │   │   ├── consensus/          ← Multi-worker + judge logic
│   │   │   ├── local-models/       ← Probes Ollama + LM Studio for available models
│   │   │   └── ...
│   │   ├── manual-coder/           ← Manual Coder page
│   │   ├── ai-coder/               ← AI Coder page
│   │   ├── qualitative-coder/      ← Qualitative Coder page
│   │   ├── consensus-coder/        ← Consensus Coder page
│   │   ├── codebook-generator/     ← Codebook Generator page
│   │   ├── transform/              ← Transform page
│   │   ├── automator/              ← Automator page
│   │   ├── generate/               ← Generate page
│   │   ├── process-documents/      ← Process Documents page
│   │   ├── model-comparison/       ← Model Comparison page
│   │   ├── history/                ← History browser page
│   │   └── settings/               ← Settings page
│   ├── components/
│   │   ├── ui/                     ← shadcn/ui primitives (Button, Dialog, etc.)
│   │   ├── tools/                  ← Shared tool components (file upload, column selector, etc.)
│   │   └── AppSidebar.tsx          ← Navigation sidebar + local model detection
│   └── lib/
│       ├── ai/
│       │   └── providers.ts        ← getModel() — returns AI SDK model for any provider
│       ├── analytics.ts            ← Cohen's κ, pairwise agreement calculations
│       ├── db-tauri.ts             ← SQLite helpers for the Tauri path (no Prisma)
│       ├── document-browser.ts     ← Browser-side PDF/DOCX text extraction
│       ├── export.ts               ← downloadCSV() — blob download or Tauri native dialog
│       ├── llm-browser.ts          ← Browser-side LLM functions used by the Tauri path
│       ├── prompts.ts              ← Prompt registry + per-tool localStorage overrides
│       ├── retry.ts                ← withRetry() with auth-error fast-fail
│       ├── store.ts                ← Zustand store for provider config
│       └── validation.ts           ← Zod schemas for all API route inputs
├── prisma/
│   ├── schema.prisma               ← Database schema
│   └── dev.db                      ← SQLite database (created on first run)
├── desktop/
│   └── tauri/                      ← Tauri desktop wrapper
│       ├── src-tauri/
│       │   ├── src/main.rs         ← Tauri application entry point
│       │   ├── capabilities/       ← Plugin permission declarations
│       │   └── tauri.conf.json     ← App config (name, bundle ID, window size)
│       └── package.json
├── public/                         ← Static assets
├── next.config.ts                  ← Next.js config (build target switched by env var)
├── package.json
└── tsconfig.json
```

---

## Architecture

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the complete technical reference, including:

- LLM call path (web vs. Tauri)
- All API routes and their responsibilities
- Database schema (tables, columns, relations)
- Autosave system design
- State management and localStorage keys
- Consensus Coder worker/judge protocol
- Desktop packaging pipeline

### LLM call path (quick summary)

**Web app:**
```
Browser → /api/process-row → providers.ts (getModel) → Provider API
                           ↘ prisma (log result to SQLite)
```

**Tauri desktop app:**
```
Browser → llm-browser.ts (getModel) → Provider API (direct, no server)
                                     ↘ db-tauri.ts (log result to SQLite)
```

The same React components render in both contexts. The difference is whether the LLM call goes through a Next.js API route (web) or directly from the WebView (Tauri).

### Autosave

Manual Coder and AI Coder write the current session state to `localStorage` after every action:

| Key | Content |
|---|---|
| `mc_autosave` | Current Manual Coder session |
| `mc_autosave_prev` | Previous Manual Coder session (one-step undo) |
| `aic_autosave` | Current AI Coder session |
| `aic_autosave_prev` | Previous AI Coder session |

On page load, a recovery banner appears if an autosaved session is detected. The user can resume or discard it.

---

## Contributing

1. Fork the repository and create a feature branch.
2. Run `npm test` to confirm the baseline passes (76 tests).
3. Make your changes. Add or update tests for any modified behaviour.
4. Run `npm run build` to confirm the TypeScript build passes with 0 errors.
5. Run `npm run lint` and fix any issues.
6. Open a pull request with a clear description of what changed and why.

---

## License

See [LICENSE](../LICENSE) in the repository root.
