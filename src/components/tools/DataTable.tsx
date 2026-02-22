"use client";

import React, { useState, useEffect } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

interface DataTableProps {
    data: any[];
    maxRows?: number;
}

export function DataTable({ data, maxRows = 100 }: DataTableProps) {
    const [expanded, setExpanded] = useState<{ col: string; value: string } | null>(null);
    const [sortCol, setSortCol] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
    const [searchQuery, setSearchQuery] = useState("");
    const [tablePage, setTablePage] = useState(0);

    useEffect(() => {
        setTablePage(0);
    }, [data]);

    if (!data || data.length === 0) return null;

    const headers = Object.keys(data[0]);

    // Filter
    const filteredData = searchQuery
        ? data.filter((row) =>
            headers.some((h) =>
                String(row[h] ?? "").toLowerCase().includes(searchQuery.toLowerCase())
            )
          )
        : data;

    // Sort
    const sortedData = sortCol
        ? [...filteredData].sort((a, b) => {
            const va = String(a[sortCol] ?? "");
            const vb = String(b[sortCol] ?? "");
            return sortDir === "asc"
                ? va.localeCompare(vb, undefined, { numeric: true })
                : vb.localeCompare(va, undefined, { numeric: true });
          })
        : filteredData;

    // Pagination
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
        <div className="rounded-md border bg-card text-card-foreground">
            {data.length > 5 && (
                <div className="px-3 py-2 border-b">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Search all columns..."
                            className="pl-8 h-8 text-xs"
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setTablePage(0); }}
                        />
                    </div>
                </div>
            )}
            <ScrollArea className="h-[400px] w-full rounded-md border">
                <Table>
                    <TableHeader className="sticky top-0 bg-secondary/80 backdrop-blur-sm z-10">
                        <TableRow>
                            {headers.map((header) => (
                                <TableHead
                                    key={header}
                                    className="font-bold cursor-pointer hover:bg-muted/30 select-none"
                                    onClick={() => handleHeaderClick(header)}
                                >
                                    <div className="flex items-center gap-1">
                                        {header}
                                        {sortCol === header && (
                                            <span className="text-xs opacity-60">
                                                {sortDir === "asc" ? "↑" : "↓"}
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
                                        className="whitespace-pre-wrap max-w-md truncate cursor-pointer hover:bg-muted/20"
                                        onClick={() => setExpanded({ col: header, value: String(row[header] ?? "") })}
                                    >
                                        {String(row[header] ?? "")}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
            <div className="px-3 py-2 border-t flex items-center justify-between text-xs text-muted-foreground">
                <span>
                    {data.length} rows{filteredData.length < data.length ? ` (${filteredData.length} filtered)` : ""}
                </span>
                {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                        <span>
                            {tablePage * maxRows + 1}–{Math.min((tablePage + 1) * maxRows, sortedData.length)} of {sortedData.length}
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
                )}
            </div>

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
        </div>
    );
}
