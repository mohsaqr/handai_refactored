/**
 * RIS bibliographic format parser.
 *
 * Parses standard RIS files (TAG  - value / ER  - delimiters) into Row[].
 * Multi-value tags (AU, KW) are accumulated and joined with "; ".
 * Records with neither title nor abstract are skipped.
 */

import type { Row } from "@/types";

// Mapping from RIS tags to output field names
const TAG_MAP: Record<string, keyof OutputFields> = {
  TI: "title",
  T1: "title",
  AB: "abstract",
  JO: "journal",
  JF: "journal",
  T2: "journal",
  PY: "year",
  Y1: "year",
  DO: "doi",
};

// Multi-value tags accumulated as arrays then joined
const MULTI_TAGS = new Set(["AU", "KW"]);

interface OutputFields {
  title: string;
  abstract: string;
  keywords: string;
  journal: string;
  year: string;
  authors: string;
  doi: string;
}

export function parseRis(text: string): Row[] {
  // Split into individual records on ER (end-of-record) marker
  const rawRecords = text.split(/^ER\s*-/m);

  const rows: Row[] = [];

  for (const record of rawRecords) {
    const fields: Partial<OutputFields> = {};
    const multiAccum: Record<string, string[]> = {};

    const lines = record.split(/\r?\n/);
    for (const line of lines) {
      // RIS line format: TAG  - value  (1–2 uppercase alphanumeric chars + spaces + dash + space)
      const match = line.match(/^([A-Z][A-Z0-9]?)\s{1,3}-\s(.*)$/);
      if (!match) continue;
      const tag = match[1].trim();
      const value = match[2].trim();
      if (!value) continue;

      if (MULTI_TAGS.has(tag)) {
        if (!multiAccum[tag]) multiAccum[tag] = [];
        multiAccum[tag].push(value);
      } else {
        const outField = TAG_MAP[tag];
        // Only set if we haven't seen a higher-priority tag for this field yet
        if (outField && !fields[outField]) {
          (fields as Record<string, string>)[outField] = value;
        }
      }
    }

    // Apply multi-value tags
    if (multiAccum.AU?.length) fields.authors = multiAccum.AU.join("; ");
    if (multiAccum.KW?.length) fields.keywords = multiAccum.KW.join("; ");

    // Skip records with no title and no abstract
    const title = fields.title ?? "";
    const abstract = fields.abstract ?? "";
    if (!title && !abstract) continue;

    rows.push({
      title,
      abstract,
      keywords: fields.keywords ?? "",
      journal: fields.journal ?? "",
      year: fields.year ?? "",
      authors: fields.authors ?? "",
      doi: fields.doi ?? "",
    });
  }

  return rows;
}
