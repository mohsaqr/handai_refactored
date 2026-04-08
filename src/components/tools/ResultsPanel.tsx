"use client";

import React from "react";
import { DataTable, ExportDropdown } from "./DataTable";
import { ExternalLink } from "lucide-react";
import Link from "next/link";

interface ResultsPanelProps {
  results: Record<string, unknown>[];
  runId: string | null;
  title?: string;
  subtitle?: string;
  extraActions?: React.ReactNode;
  children?: React.ReactNode;
}

export function ResultsPanel({
  results,
  runId,
  title = "Results",
  subtitle,
  extraActions,
  children,
}: ResultsPanelProps) {
  if (results.length === 0) return null;

  const defaultSubtitle =
    subtitle ?? `${results.length} rows processed`;

  return (
    <div className="space-y-4 border-t pt-6 pb-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {defaultSubtitle}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {runId && (
            <Link
              href={`/history/${runId}`}
              className="flex items-center gap-1.5 text-xs text-indigo-500 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              View in History
            </Link>
          )}
          {extraActions}
        </div>
      </div>

      {children}

      <div className="border rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium flex items-center justify-between flex-wrap gap-2">
          <span>{title} — {results.length} rows</span>
          <ExportDropdown data={results as Record<string, unknown>[]} filename="results" />
        </div>
        <DataTable data={results} />
      </div>
    </div>
  );
}
