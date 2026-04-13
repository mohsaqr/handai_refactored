"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Download, ChevronDown } from "lucide-react";
import * as XLSX from "xlsx";

interface DataTableProps {
    data: Record<string, unknown>[];
    maxRows?: number;
}

type ExportFormat = "csv" | "json" | "xlsx" | "md";

export function exportData(data: Record<string, unknown>[], format: ExportFormat, filename?: string) {
    if (format === "xlsx") {
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Data");
        XLSX.writeFile(wb, `${filename || "data"}.xlsx`);
        return;
    }

    const headers: string[] = [];
    {
        const seen = new Set<string>();
        for (const row of data) {
            for (const key of Object.keys(row)) {
                if (!seen.has(key)) { seen.add(key); headers.push(key); }
            }
        }
    }
    let content: string;
    let mimeType: string;
    let ext: string;

    if (format === "csv") {
        content = [
            headers.join(","),
            ...data.map((r) =>
                headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")
            ),
        ].join("\n");
        mimeType = "text/csv;charset=utf-8;";
        ext = "csv";
    } else if (format === "md") {
        content = data.map((r, i) => {
            const lines = headers.map((h) => `**${h}:** ${String(r[h] ?? "")}`);
            return `### Row ${i + 1}\n\n${lines.join("\n\n")}`;
        }).join("\n\n---\n\n");
        mimeType = "text/markdown;charset=utf-8;";
        ext = "md";
    } else {
        content = JSON.stringify(data, null, 2);
        mimeType = "application/json;charset=utf-8;";
        ext = "json";
    }

    const blob = new Blob(["\uFEFF" + content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename || "data"}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
}

/** Dropdown button for exporting data in multiple formats. */
export function ExportDropdown({ data, filename }: { data: Record<string, unknown>[]; filename?: string }) {
    const [showMenu, setShowMenu] = useState(false);

    if (!data || data.length === 0) return null;

    return (
        <div className="relative">
            <Button
                variant="outline"
                className="h-9 px-4 text-sm gap-1.5 font-medium"
                onClick={() => setShowMenu((v) => !v)}
            >
                <Download className="h-4 w-4" />
                Export
                <ChevronDown className="h-3.5 w-3.5 opacity-50" />
            </Button>
            {showMenu && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 border rounded-md bg-popover shadow-md py-1 min-w-[120px]">
                        {(["xlsx", "csv", "json", "md"] as ExportFormat[]).map((fmt) => (
                            <button
                                key={fmt}
                                className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                                onClick={() => {
                                    exportData(data, fmt, filename);
                                    setShowMenu(false);
                                }}
                            >
                                {fmt === "xlsx" ? "Excel" : fmt === "md" ? "Markdown" : fmt.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

export function DataTable({ data, maxRows = 10 }: DataTableProps) {
    const [expanded, setExpanded] = useState<{ col: string; value: string } | null>(null);
    const [sortCol, setSortCol] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
    const [tablePage, setTablePage] = useState(0);

    useEffect(() => {
        queueMicrotask(() => setTablePage(0));
    }, [data]);

    // Sort — must be called before early return to satisfy hook rules
    const sortedData = useMemo(() => {
        if (!data || data.length === 0) return [];
        if (!sortCol) return data;
        return [...data].sort((a, b) => {
            const va = String(a[sortCol] ?? "");
            const vb = String(b[sortCol] ?? "");
            return sortDir === "asc"
                ? va.localeCompare(vb, undefined, { numeric: true })
                : vb.localeCompare(va, undefined, { numeric: true });
        });
    }, [data, sortCol, sortDir]);

    if (!data || data.length === 0) return null;

    const headers: string[] = [];
    {
        const seen = new Set<string>();
        for (const row of data) {
            for (const key of Object.keys(row)) {
                if (!seen.has(key)) { seen.add(key); headers.push(key); }
            }
        }
    }

    const totalPages = Math.ceil(sortedData.length / maxRows);
    const displayData = sortedData.slice(tablePage * maxRows, (tablePage + 1) * maxRows);

    const handleHeaderClick = (header: string) => {
        if (sortCol === header) {
            if (sortDir === "asc") setSortDir("desc");
            else { setSortCol(null); setSortDir("asc"); }
        } else {
            setSortCol(header);
            setSortDir("asc");
        }
    };

    return (
        <>
            <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_var(--color-border)]">
                    <TableRow>
                        {headers.map((header) => (
                            <TableHead
                                key={header}
                                className="font-bold cursor-pointer hover:bg-muted/80 select-none"
                                onClick={() => handleHeaderClick(header)}
                            >
                                <div className="flex items-center gap-1">
                                    {header}
                                    {sortCol === header && (
                                        <span className="text-xs opacity-60">
                                            {sortDir === "asc" ? "\u2191" : "\u2193"}
                                        </span>
                                    )}
                                </div>
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {displayData.map((row, i) => (
                        <TableRow key={i}>
                            {headers.map((header) => (
                                <TableCell
                                    key={`${i}-${header}`}
                                    className="max-w-[40vw] cursor-pointer hover:bg-muted/20"
                                    onClick={() => setExpanded({ col: header, value: String(row[header] ?? "") })}
                                >
                                    <div className="line-clamp-2 break-words text-sm">
                                        {String(row[header] ?? "")}
                                    </div>
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            {totalPages > 1 && (
                <div className="px-3 py-2 flex items-center justify-between text-xs text-muted-foreground border-t bg-muted/20">
                    <span>{data.length} rows</span>
                    <div className="flex items-center gap-2">
                        <span>
                            {tablePage * maxRows + 1}&ndash;{Math.min((tablePage + 1) * maxRows, sortedData.length)} of {sortedData.length}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2"
                            onClick={() => setTablePage((p) => Math.max(0, p - 1))}
                            disabled={tablePage === 0}
                        >
                            <ChevronLeft className="h-3 w-3" />
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2"
                            onClick={() => setTablePage((p) => Math.min(totalPages - 1, p + 1))}
                            disabled={tablePage >= totalPages - 1}
                        >
                            <ChevronRight className="h-3 w-3" />
                        </Button>
                    </div>
                </div>
            )}

            <Dialog open={!!expanded} onOpenChange={() => setExpanded(null)}>
                <DialogContent className="max-w-2xl max-h-[80vh]">
                    <DialogHeader>
                        <DialogTitle className="text-sm font-mono">{expanded?.col}</DialogTitle>
                    </DialogHeader>
                    <pre className="text-sm font-mono whitespace-pre-wrap break-words overflow-y-auto max-h-[60vh] bg-muted/20 p-4 rounded border">
                        {expanded?.value}
                    </pre>
                </DialogContent>
            </Dialog>
        </>
    );
}
