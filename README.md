# Handai — AI Data Suite (Web App)

A qualitative and quantitative data analysis suite powered by LLMs. Runs as a web app or as a native desktop app (Tauri) — no code changes required between the two.

---

## Quick Start

```bash
cd web
npm install
npm run dev          # → http://localhost:3000
```

### Add an API key

Open **Settings** → choose a provider (OpenAI, Anthropic, Google, etc.) → paste your key. Local providers (Ollama, LM Studio) are detected automatically — no configuration needed.

---

## Tools

| Tool | Description |
|---|---|
| **Manual Coder** | High-speed keyboard-driven qualitative coding |
| **AI Coder** | AI suggests codes row-by-row; human reviews + overrides |
| **Qualitative Coder** | Batch LLM coding against a codebook |
| **Consensus Coder** | Multi-model coding + inter-rater agreement (Cohen's κ) |
| **Codebook Generator** | LLM-assisted inductive codebook creation |
| **Transform** | Apply any LLM transformation to CSV rows |
| **Automator** | Multi-step LLM pipeline builder |
| **Generate** | Synthesize realistic datasets |
| **Process Documents** | Extract structured data from PDFs/DOCX |
| **Model Comparison** | Side-by-side output from N models |
| **History** | Browse + export all run results |
| **Settings** | Providers, API keys, prompt templates |

---

## Scripts

```bash
npm run dev      # Start dev server (port 3000)
npm run build    # Production build (0 TS errors required)
npm test         # Vitest — 76 tests across 4 suites
npm run lint     # ESLint
```

---

## Desktop App

The web app builds with `output: "export"` (Tauri) or `output: "standalone"` (web) and can be wrapped in a native desktop shell. See [`desktop/README.md`](desktop/README.md) for build instructions.

```
desktop/
  tauri/       ← Tauri wrapper (~10 MB, uses system WebView, browser-side LLM)
```

---

## Architecture

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the complete technical reference:
- Data flow + LLM call path
- API routes reference
- Database schema
- Autosave system
- Stability properties
- Desktop packaging phases

---

## Supported LLM Providers

OpenAI · Anthropic · Google Gemini · Groq · Together AI · Azure OpenAI · OpenRouter · Ollama (local) · LM Studio (local) · Custom OpenAI-compatible endpoint

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4, shadcn/ui |
| LLM SDK | Vercel AI SDK v4 |
| Database | Prisma 6 + SQLite |
| State | Zustand (localStorage persisted) |
| Testing | Vitest |
| Desktop | Tauri 2 |

---

## Project Layout

```
web/
├── src/
│   ├── app/           ← Pages + 10 API routes
│   ├── components/    ← UI components + tool components
│   └── lib/           ← Store, hooks, providers, validation, export utils
├── prisma/            ← Schema + dev database
├── desktop/           ← Electron + Tauri wrappers
└── ARCHITECTURE.md    ← Full technical reference
```
