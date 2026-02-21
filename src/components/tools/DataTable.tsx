"use client";

import React from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

interface DataTableProps {
    data: any[];
    maxRows?: number;
}

export function DataTable({ data, maxRows = 100 }: DataTableProps) {
    if (!data || data.length === 0) return null;

    const displayData = data.slice(0, maxRows);
    const headers = Object.keys(data[0]);

    return (
        <div className="rounded-md border bg-card text-card-foreground">
            <ScrollArea className="h-[400px] w-full rounded-md border">
                <Table>
                    <TableHeader className="sticky top-0 bg-secondary/80 backdrop-blur-sm z-10">
                        <TableRow>
                            {headers.map((header) => (
                                <TableHead key={header} className="font-bold">
                                    {header}
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {displayData.map((row, i) => (
                            <TableRow key={i}>
                                {headers.map((header) => (
                                    <TableCell key={`${i}-${header}`} className="whitespace-pre-wrap max-w-md truncate">
                                        {String(row[header] ?? "")}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                <ScrollBar orientation="horizontal" />
            </ScrollArea>
            {data.length > maxRows && (
                <div className="p-2 text-center text-xs text-muted-foreground border-t">
                    Showing first {maxRows} of {data.length} rows
                </div>
            )}
        </div>
    );
}
