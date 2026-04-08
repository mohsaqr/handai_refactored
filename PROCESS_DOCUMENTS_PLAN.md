# Plan: Split Process Documents into Extract Data + Process Documents

## Context
The current "Process Documents" tool only does structured field extraction. We want two separate tools:
1. **Extract Data** — current structured extraction (unchanged functionality, new URL)
2. **Process Documents** — general-purpose: upload docs → pick output format → write instructions → get free-form output

The new Process Documents must follow the same UI/UX pattern as other tools (numbered sections, shared components).

---

## Tool 1: Extract Data (`/extract-data`)

**What it is:** Exact copy of current Process Documents — no functionality changes.

**Changes from current:**
- New page at `src/app/extract-data/page.tsx`
- Title: "Extract Data"
- Subtitle: "Extract structured tabular data from documents using AI"
- Different sessionStorage prefix (`extractdata_` instead of `procdocs_`)
- Different run type (`extract-data`)
- Everything else identical: field schema, templates, AI suggest, DataTable output, CSV/XLSX export

---

## Tool 2: Process Documents (`/process-documents`) — REWRITE

### Page Structure (follows standard tool pattern)

**Section 1: Upload Documents**
- Same dropzone + file list as current
- Accept PDF, DOCX, Excel, TXT, MD, JSON, CSV, HTML
- File status indicators (pending, extracting, done, error)

**Section 2: Output Format** (NEW — radio buttons, same style as Generate Data)
- CSV
- Excel (.xlsx)
- JSON
- Text (.txt)
- PDF
- HTML
- Markdown (.md)

**Section 3: Instructions**
- `PromptEditor` textarea for free-form instructions
- Sample prompts dropdown:
  - "Summarize this document in 3 bullet points"
  - "Translate this document to French"
  - "Extract the key findings and recommendations"
  - "List all people, organizations, and dates mentioned"
  - "Answer: What is the main argument of this paper?"
  - "Create a structured outline of this document"

**Section 4: AI Instructions**
- `AIInstructionsSection` component (auto-generated from user prompt)
- No field schema references

**Section 5: Execute**
- Two buttons: Test (1 file) + Process All (red)
- Progress bar for multi-file processing
- Abort button during processing

**Results Section**
- Per-document result cards:
  - Document name as header
  - LLM output text (whitespace-preserving)
  - Copy button per document
- Export in the chosen output format
- Link to run history

### State Variables
- `fileStates: FileState[]` — uploaded files
- `outputFormat: string` — chosen export format
- `customPrompt: string` — user instructions
- `aiInstructions: string` — auto-generated system prompt
- `isProcessing: boolean`
- `progress: { completed, total }`
- `allResults: { document_name: string, output: string }[]`
- `runId: string | null`

---

## Backend Changes

### New API Route: `src/app/api/document-process/route.ts`
- Accept: file content + systemPrompt (no fields)
- Extract text from document (same extraction logic as document-extract)
- Send extracted text + user's prompt to LLM
- Return: `{ text: string, fileName: string, charCount: number, truncated: boolean }`
- No CSV parsing — raw LLM text output

### New Dispatch Function: `dispatchDocumentProcess()`
In `src/lib/llm-dispatch.ts`:
- Same branching pattern (web API vs browser-direct)
- Returns `{ text, fileName, charCount, truncated }`

### New Browser-Direct Function: `documentProcessDirect()`
In `src/lib/llm-browser.ts`:
- Extract text via `extractTextBrowser()`
- Send to LLM with user's prompt
- Return raw text output

### New Validation Schema: `DocumentProcessSchema`
In `src/lib/validation.ts`:
- Same as `DocumentExtractSchema` without `fields`
- `systemPrompt` required

---

## Export Additions

In `src/lib/export.ts`, add:

| Function | Output |
|----------|--------|
| `downloadText(entries, filename)` | `.txt` — documents separated by headers |
| `downloadMarkdown(entries, filename)` | `.md` — documents as markdown sections |
| `downloadHTML(entries, filename)` | `.html` — styled HTML document |
| `downloadPDF(entries, filename)` | `.pdf` — via browser print or lightweight lib |

Each takes `{ document_name: string, output: string }[]`.

For CSV/Excel/JSON export, shape data as `[{ document_name, output }]` and use existing `ExportDropdown`.

---

## Sidebar Update

In `src/components/AppSidebar.tsx`, replace single "Process Documents" entry with:

```
{ title: "Extract Data",       url: "/extract-data",       icon: TableProperties }
{ title: "Process Documents",  url: "/process-documents",  icon: FileText }
```

Both under the "Data Processing" group.

---

## Prompt Registry

In `src/lib/prompts.ts`, add:

```
document.process — "You are a document processing assistant. Process the document according to the user's instructions. Return your response as plain text."
```

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/app/extract-data/page.tsx` | CREATE (copy of current process-documents) |
| `src/app/process-documents/page.tsx` | REWRITE (free-form prompt + text output) |
| `src/app/api/document-process/route.ts` | CREATE (new API route) |
| `src/lib/llm-dispatch.ts` | ADD `dispatchDocumentProcess` |
| `src/lib/llm-browser.ts` | ADD `documentProcessDirect` |
| `src/lib/validation.ts` | ADD `DocumentProcessSchema` |
| `src/lib/export.ts` | ADD text/markdown/html/pdf export functions |
| `src/lib/prompts.ts` | ADD `document.process` prompt template |
| `src/components/AppSidebar.tsx` | Update nav entries (add Extract Data) |

**Untouched:** `document-extract/route.ts`, `document-analyze/route.ts`, `document-browser.ts`, `DataTable.tsx`

---

## Verification Checklist

- [ ] `npx tsc --noEmit` — 0 errors
- [ ] `npm test` — all tests pass
- [ ] Extract Data: upload PDF → define fields → process → structured table → export CSV
- [ ] Process Documents: upload PDF → pick output format → write "Summarize" → process → text cards → export
- [ ] Both tools visible in sidebar
- [ ] Session persistence works (navigate away and back)
- [ ] Start Over resets everything on both tools
- [ ] All 7 export formats work in Process Documents
