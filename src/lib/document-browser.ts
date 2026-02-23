/**
 * Browser-side document text extraction — replaces Node.js `pdf-parse` + `mammoth`
 * CommonJS server modules used in /api/document-extract.
 *
 * Used in Tauri (static export, no API routes available).
 *
 * File types:
 *  .pdf  → pdfjs-dist (WASM, runs in WebView main thread)
 *  .docx → mammoth browser build (arrayBuffer API)
 *  .txt / .md → FileReader (UTF-8 text decode)
 */

/**
 * Extract plain text from a File object using browser-native APIs.
 * Returns the raw text content — identical in shape to what the server-side
 * extractText() function returns in document-extract/route.ts.
 */
export async function extractTextBrowser(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return file.text();
  }

  if (name.endsWith(".docx")) {
    return extractDocx(file);
  }

  if (name.endsWith(".pdf")) {
    return extractPdf(file);
  }

  // Fallback: attempt to read as plain text
  return file.text();
}

// ── DOCX via mammoth browser build ────────────────────────────────────────────

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  // mammoth supports both { buffer } (Node) and { arrayBuffer } (browser)
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

// ── PDF via pdfjs-dist ────────────────────────────────────────────────────────

async function extractPdf(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");

  // Configure worker — Next.js/webpack resolves import.meta.url at build time
  // and copies the worker file to the static output directory.
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.mjs",
      import.meta.url
    ).toString();
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    pageTexts.push(pageText);
  }

  return pageTexts.join("\n");
}
