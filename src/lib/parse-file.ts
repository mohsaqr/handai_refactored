import Papa from "papaparse";
import * as XLSX from "xlsx";
import { parseRis } from "@/lib/ris-parser";

type Row = Record<string, unknown>;

export function getFileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function isStructuredExt(ext: string): boolean {
  return ext === "csv" || ext === "xlsx" || ext === "xls" || ext === "json" || ext === "ris";
}

/** Parses a structured file (CSV/XLSX/XLS/JSON/RIS) into rows. Returns null for
 * unstructured extensions, parse failures, or JSON that isn't an array of objects. */
export async function parseStructuredFile(file: File): Promise<Row[] | null> {
  const ext = getFileExt(file.name);
  try {
    if (ext === "csv") {
      const text = await file.text();
      return Papa.parse<Row>(text, { header: true, skipEmptyLines: true }).data;
    }
    if (ext === "xlsx" || ext === "xls") {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      return XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]]);
    }
    if (ext === "json") {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.every((v) => v !== null && typeof v === "object" && !Array.isArray(v))) {
        return parsed as Row[];
      }
      return null;
    }
    if (ext === "ris") {
      const text = await file.text();
      const rows = parseRis(text);
      return rows.length > 0 ? rows : null;
    }
  } catch {
    return null;
  }
  return null;
}
