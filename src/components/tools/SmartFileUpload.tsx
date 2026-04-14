"use client";

import React from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { DataTable, ExportDropdown } from "@/components/tools/DataTable";

type Row = Record<string, unknown>;

export type FileStatus = "pending" | "processing" | "done" | "error";

interface Props {
  file: File | null;
  status: FileStatus;
  errorMessage?: string;
  previewRows: Row[] | null;
  onDrop: (files: File[]) => void;
  onClear: () => void;
  onLoadSample: (key: string) => void;
}

export function SmartFileUpload({ file, status, errorMessage, previewRows, onDrop, onClear, onLoadSample }: Props) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: false });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select onValueChange={onLoadSample}>
          <SelectTrigger className="w-[200px] h-9 text-xs">
            <SelectValue placeholder="-- Load sample..." />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(SAMPLE_DATASETS).map((key) => (
              <SelectItem key={key} value={key} className="text-xs">
                {SAMPLE_DATASETS[key].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/20"
        }`}
      >
        <input {...getInputProps()} />
        <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {isDragActive ? "Drop file here..." : "Drop a file here or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          PDF, DOCX, Excel, TXT, MD, JSON, CSV, HTML
        </p>
        <p className="text-[11px] text-muted-foreground/60 mt-1 italic">
          Optional — leave empty to run a single prompt from worker instructions
        </p>
      </div>

      {file && (
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-muted/20">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="flex-1 truncate text-xs">{file.name}</span>
            {file.size === 0 ? (
              <span className="text-[10px] text-red-600 dark:text-red-400 shrink-0 italic" title="Restored placeholder — original file contents are not stored. Re-upload the file to re-run.">
                Placeholder · re-upload to re-run
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {(file.size / 1024).toFixed(0)} KB
              </span>
            )}

            {status === "pending" && (
              <span className="text-[10px] text-muted-foreground shrink-0">Pending</span>
            )}
            {status === "processing" && (
              <span className="flex items-center gap-1 text-[10px] text-purple-600 shrink-0">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing
              </span>
            )}
            {status === "done" && (
              <span className="flex items-center gap-1 text-[10px] text-green-600 shrink-0">
                <CheckCircle2 className="h-3.5 w-3.5" /> Done
              </span>
            )}
            {status === "error" && (
              <span className="flex items-center gap-1 text-[10px] text-red-500 shrink-0" title={errorMessage}>
                <AlertCircle className="h-3.5 w-3.5" /> Error
              </span>
            )}

            <button onClick={onClear} className="text-muted-foreground hover:text-destructive shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {status === "error" && errorMessage && (
            <div className="ml-3 text-[10px] text-red-500 leading-snug">{errorMessage}</div>
          )}
        </div>
      )}

      {previewRows && previewRows.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium flex items-center justify-between flex-wrap gap-2">
            <span>Data Preview — {previewRows.length} rows{file ? ` · ${file.name}` : ""}</span>
            <ExportDropdown data={previewRows} filename="preview" />
          </div>
          <DataTable data={previewRows} />
        </div>
      )}
    </div>
  );
}
