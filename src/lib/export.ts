/**
 * Shared CSV/XLSX download utility.
 *
 * Builds a blob URL and triggers an anchor-click download in the browser.
 */
import * as XLSX from "xlsx";

export async function downloadXLSX(rows: Record<string, unknown>[], filename: string): Promise<void> {
  if (!rows.length) return;
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const fname = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, fname);
}

// ── Document output exports ──────────────────────────────────────────────────

interface DocEntry {
  document_name: string;
  output: string;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(entries: DocEntry[], filename: string): void {
  const content = entries
    .map((e) => `=== ${e.document_name} ===\n\n${e.output}`)
    .join("\n\n---\n\n");
  triggerDownload(new Blob([content], { type: "text/plain;charset=utf-8" }), filename.endsWith(".txt") ? filename : `${filename}.txt`);
}

export function downloadMarkdown(entries: DocEntry[], filename: string): void {
  const content = entries
    .map((e) => `# ${e.document_name}\n\n${e.output}`)
    .join("\n\n---\n\n");
  triggerDownload(new Blob([content], { type: "text/markdown;charset=utf-8" }), filename.endsWith(".md") ? filename : `${filename}.md`);
}

export function downloadHTML(entries: DocEntry[], filename: string): void {
  const body = entries
    .map((e) => `<article><h2>${e.document_name.replace(/</g, "&lt;")}</h2><pre style="white-space:pre-wrap;font-family:inherit">${e.output.replace(/</g, "&lt;")}</pre></article>`)
    .join("<hr>");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${filename}</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6}h2{margin-top:2rem}hr{margin:2rem 0;border:none;border-top:1px solid #ddd}</style></head><body>${body}</body></html>`;
  triggerDownload(new Blob([html], { type: "text/html;charset=utf-8" }), filename.endsWith(".html") ? filename : `${filename}.html`);
}

export function downloadPDF(entries: DocEntry[], filename: string): void {
  // Build a printable HTML document and use browser print dialog
  const body = entries
    .map((e) => `<article><h2>${e.document_name.replace(/</g, "&lt;")}</h2><pre style="white-space:pre-wrap;font-family:inherit">${e.output.replace(/</g, "&lt;")}</pre></article>`)
    .join("<hr>");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${filename}</title><style>body{font-family:system-ui,sans-serif;max-width:100%;margin:1rem;line-height:1.6}h2{margin-top:2rem}hr{margin:2rem 0;border:none;border-top:1px solid #ddd}@media print{body{margin:0}}</style></head><body>${body}<script>window.onload=function(){window.print()}<\/script></body></html>`;
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

// ── Tabular exports ──────────────────────────────────────────────────────────

export async function downloadCSV(rows: Record<string, unknown>[], filename: string): Promise<void> {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      headers
        .map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`)
        .join(",")
    ),
  ].join("\n");
  const content = "\uFEFF" + csv;

  // Standard blob URL download
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
