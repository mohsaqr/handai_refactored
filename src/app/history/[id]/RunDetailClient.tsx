"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, ExportDropdown } from "@/components/tools/DataTable";
import {
    ArrowLeft,
    Download,
    Calendar,
    Clock,
    Cpu,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Trash2,
    ChevronRight,
    RotateCcw,
    Copy,
    Check,
    Pencil,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { toast } from "sonner";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { getRun as idbGetRun, deleteRun as idbDeleteRun, renameRun as idbRenameRun } from "@/lib/db-indexeddb";
import { useRestoreStore, type RestorePayload } from "@/lib/restore-store";
import { useBrowserStorage } from "@/lib/llm-dispatch";
import type { RunMeta, RunResult } from "@/types";

const useBrowserDb = useBrowserStorage;

export default function RunDetailClient({ id }: { id: string }) {
    const router = useRouter();
    const [run, setRun] = useState<RunMeta | null>(null);
    const [results, setResults] = useState<Record<string, unknown>[]>([]);
    const [rawResults, setRawResults] = useState<RunResult[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState("");
    const editRef = useRef<HTMLInputElement>(null);
    const setPendingRestore = useRestoreStore((s) => s.setPending);
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

    /** Turn a single RunResult into one or more display rows. */
    const buildResultRows = (r: RunResult, runType?: string): Record<string, unknown>[] => {
        const input = JSON.parse(r.inputJson ?? "{}");
        const hasAiOutput = Object.keys(input).some((k) => k.startsWith("ai_output"));

        const meta = {
            status: r.status,
            latency_ms: Math.round((r.latency ?? 0) * 1000),
            ...(r.errorMessage ? { error_message: r.errorMessage } : {}),
        };

        // process-documents outputs are freeform text — never parse/spread them
        if (runType === "process-documents") {
            return [{ ...input, output: r.output ?? "", ...meta }];
        }

        // If output is a JSON object (e.g. automator), spread its fields instead of adding an "output" column
        if (!hasAiOutput && r.output) {
            if (typeof r.output === "string") {
                try {
                    const parsed = JSON.parse(r.output);
                    // Array of objects (e.g. extract-data records) → one row per record
                    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {
                        return parsed.map((rec: Record<string, unknown>) => ({ ...input, ...rec, ...meta }));
                    }
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                        return [{ ...input, ...parsed, ...meta }];
                    }
                } catch {
                    // not JSON — fall through
                }
            } else if (typeof r.output === "object") {
                return [{ ...input, ...(r.output as Record<string, unknown>), ...meta }];
            }
        }

        return [{ ...input, ...(hasAiOutput ? {} : { output: r.output }), ...meta }];
    };

    useEffect(() => {
        const fetchRunDetail = async () => {
            try {
                if (useBrowserDb) {
                    const data = await idbGetRun(id);
                    if (!data) throw new Error("Run not found");
                    setRun(data.run);
                    const typedResults = data.results as RunResult[];
                    setRawResults(typedResults);
                    setResults(typedResults.flatMap((r) => buildResultRows(r, data.run.runType)));
                } else {
                    const res = await fetch(`/api/runs/${id}`);
                    const data = await res.json();
                    if (data.error) throw new Error(data.error);
                    setRun(data.run);
                    setRawResults(data.results);
                    setResults(data.results.flatMap((r: RunResult) => buildResultRows(r, data.run.runType)));
                }
            } catch {
                toast.error("Failed to load run details");
            } finally {
                setIsLoading(false);
            }
        };
        fetchRunDetail();
    }, [id]);

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            if (useBrowserDb) {
                const result = await idbDeleteRun(id);
                if (!result.ok) throw new Error("Delete failed");
            } else {
                const res = await fetch(`/api/runs/${id}`, { method: "DELETE" });
                if (!res.ok) throw new Error("Delete failed");
            }
            toast.success("Run deleted");
            router.push("/history");
        } catch {
            toast.error("Failed to delete run");
            setIsDeleting(false);
        }
    };

    const startEditing = () => {
        setEditName(run?.inputFile ?? "");
        setIsEditing(true);
        setTimeout(() => editRef.current?.select(), 0);
    };

    const handleRename = async () => {
        const trimmed = editName.trim();
        if (!trimmed || !run || trimmed === run.inputFile) {
            setIsEditing(false);
            return;
        }
        try {
            if (useBrowserDb) {
                const result = await idbRenameRun(id, trimmed);
                if (!result.ok) throw new Error("Rename failed");
            } else {
                const res = await fetch(`/api/runs/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ inputFile: trimmed }),
                });
                if (!res.ok) throw new Error("Rename failed");
            }
            setRun({ ...run, inputFile: trimmed });
            toast.success("Renamed");
        } catch {
            toast.error("Failed to rename");
        }
        setIsEditing(false);
    };

    const handleRestore = () => {
        if (!run || rawResults.length === 0) return;

        // Reconstruct original data rows from inputJson
        const data = rawResults.map((r: RunResult) => JSON.parse(r.inputJson ?? "{}"));

        // Build merged result rows (same shape tool pages expect)
        const mergedResults = rawResults.map((r: RunResult) => {
            const input = JSON.parse(r.inputJson ?? "{}");
            const hasAiOutput = Object.keys(input).some((k) => k.startsWith("ai_output"));

            // process-documents: keep output as-is, detect format from system prompt
            if (run.runType === "process-documents") {
                const sp = run.systemPrompt ?? "";
                const fmt = sp.includes("Return ONLY raw CSV") ? "csv"
                    : sp.includes("Return ONLY a JSON array") ? "json"
                    : sp.includes("Return Markdown") ? "md"
                    : sp.includes("Return Moodle GIFT format") ? "gift"
                    : "txt";
                return {
                    ...input,
                    output: r.output ?? "",
                    ...(fmt === "csv" ? { _all_records: r.output ?? "" } : {}),
                    _format: fmt,
                    status: r.status ?? "success",
                    latency_ms: Math.round((r.latency ?? 0) * 1000),
                    ...(r.errorMessage ? { error_msg: r.errorMessage } : {}),
                };
            }

            let outputFields: Record<string, unknown> = {};
            if (!hasAiOutput && r.output) {
                // Qualitative coder uses ai_code as the output column name
                if (run.runType === "qualitative-coder") {
                    outputFields = { ai_code: r.output };
                // Consensus coder saves judge_output as the output
                } else if (run.runType === "consensus-coder") {
                    outputFields = { judge_output: r.output };
                } else if (typeof r.output === "string") {
                    try {
                        const parsed = JSON.parse(r.output);
                        if (Array.isArray(parsed)) {
                            // JSON array (e.g. extract-data records) — keep as _all_records
                            outputFields = { _all_records: r.output, _record_count: parsed.length };
                        } else if (parsed && typeof parsed === "object") {
                            outputFields = parsed;
                        } else {
                            outputFields = { ai_output: r.output };
                        }
                    } catch {
                        outputFields = { ai_output: r.output };
                    }
                } else if (typeof r.output === "object") {
                    outputFields = r.output as Record<string, unknown>;
                }
            }

            return {
                ...input,
                ...outputFields,
                status: r.status ?? "success",
                latency_ms: Math.round((r.latency ?? 0) * 1000),
                ...(r.errorMessage ? { error_msg: r.errorMessage } : {}),
            };
        });

        const payload: RestorePayload = {
            runId: run.id,
            runType: run.runType,
            data,
            dataName: run.inputFile ?? "restored",
            systemPrompt: run.systemPrompt ?? "",
            results: mergedResults,
            provider: run.provider,
            model: run.model,
            temperature: run.temperature ?? 0,
        };

        setPendingRestore(payload);
        router.push(`/${run.runType}`);
    };

    // Tools that support session restore (have row-level input data)
    const restorableTools = new Set([
        "transform", "qualitative-coder", "consensus-coder",
        "model-comparison", "automator", "abstract-screener",
        "ai-coder", "codebook-generator", "ai-agents", "generate",
        "extract-data", "process-documents",
    ]);
    const canRestore = run && rawResults.length > 0 && restorableTools.has(run.runType);

    if (isLoading) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            </div>
        );
    }

    if (!run) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
                <AlertCircle className="h-12 w-12 text-muted-foreground" />
                <h2 className="text-xl font-semibold">Run not found</h2>
                <Button asChild variant="outline"><Link href="/history">Back to History</Link></Button>
            </div>
        );
    }

    const handleExport = () => {
        if (results.length === 0) return;
        const csv = [
            Object.keys(results[0]).join(","),
            ...results.map(row => Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
        ].join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `run_${run.id}_results.csv`;
        a.click();
    };

    return (
        <div className="space-y-6 pb-20">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button asChild variant="ghost" size="icon">
                        <Link href="/history"><ArrowLeft className="h-5 w-5" /></Link>
                    </Button>
                    <div>
                        <div className="flex items-center gap-2">
                            {isEditing ? (
                                <Input
                                    ref={editRef}
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    onBlur={handleRename}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") handleRename();
                                        if (e.key === "Escape") setIsEditing(false);
                                    }}
                                    className="h-8 text-xl font-bold w-[300px] border-none shadow-none focus-visible:ring-1 px-0"
                                />
                            ) : (
                                <>
                                    <h1 className="text-xl font-bold">{run.inputFile}</h1>
                                    <button
                                        onClick={startEditing}
                                        className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted"
                                        title="Rename"
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                </>
                            )}
                            <Badge variant="outline" className="capitalize">{run.runType}</Badge>
                        </div>
                        <p className="text-muted-foreground text-xs">Run ID: {run.id}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {canRestore && (
                        <Button onClick={handleRestore} size="sm" variant="default">
                            <RotateCcw className="h-4 w-4 mr-2" /> Restore Session
                        </Button>
                    )}
                    <Button onClick={handleExport} size="sm" variant="outline">
                        <Download className="h-4 w-4 mr-2" /> Export CSV
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowDeleteDialog(true)}
                        className="border-red-300 text-red-600 hover:bg-red-50"
                    >
                        <Trash2 className="h-4 w-4 mr-2" /> Delete Run
                    </Button>
                </div>
            </div>

            <div className="grid md:grid-cols-5 gap-6">
                <Card className="md:col-span-1 min-w-0">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Run Stats</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label>Status</Label>
                                <div className="flex items-center gap-1 text-sm font-medium">
                                    {run.status === "completed" ? (
                                        <><CheckCircle2 className="h-3 w-3 text-green-500" /> Success</>
                                    ) : (
                                        <><Clock className="h-3 w-3 text-amber-500" /> {run.status}</>
                                    )}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <Label>Model</Label>
                                <div className="text-sm font-medium">{run.model}</div>
                            </div>
                            <div className="space-y-1">
                                <Label>Total Rows</Label>
                                <div className="text-sm font-medium">{run.inputRows}</div>
                            </div>
                            <div className="space-y-1">
                                <Label>Avg Latency</Label>
                                <div className="text-sm font-medium">{(run.avgLatency / 1000).toFixed(2)}s</div>
                            </div>
                        </div>
                        <Separator />
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                <Calendar className="h-3 w-3" />
                                {new Date(run.startedAt).toLocaleString()}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                <Cpu className="h-3 w-3" />
                                Provider: {run.provider}
                            </div>
                        </div>
                        <Separator />
                        <Collapsible>
                            <CollapsibleTrigger className="flex items-center gap-2 w-full text-xs font-medium hover:text-foreground text-muted-foreground">
                                <ChevronRight className="h-3.5 w-3.5 transition-transform [[data-state=open]_&]:rotate-90" />
                                System Prompt Used
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <pre className="text-xs font-mono bg-muted/10 p-3 mt-2 rounded border whitespace-pre-wrap break-words">
                                    {run.systemPrompt || "—"}
                                </pre>
                            </CollapsibleContent>
                        </Collapsible>
                    </CardContent>
                </Card>

                <div className="md:col-span-4 min-w-0">
                    {(() => {
                        const sp = run.systemPrompt ?? "";

                        // ── Helpers ──────────────────────────────────────────────
                        const detectFormat = () => {
                            if (sp.includes("Return ONLY raw CSV")) return { label: "CSV", ext: "csv", font: "font-mono" } as const;
                            if (sp.includes("Return ONLY a JSON array") || sp.includes("Format: json")) return { label: "JSON", ext: "json", font: "font-mono" } as const;
                            if (sp.includes("Return Markdown") || sp.includes("Format: Markdown")) return { label: "Markdown", ext: "md", font: "font-sans" } as const;
                            if (sp.includes("Return Moodle GIFT format") || sp.includes("Format: Moodle GIFT")) return { label: "GIFT", ext: "gift", font: "font-sans" } as const;
                            if (sp.includes("Format: plain readable text") || sp.includes("Return plain readable text")) return { label: "Free Text", ext: "txt", font: "font-sans" } as const;
                            return null;
                        };

                        const fmt = detectFormat();

                        const copyToClipboard = (text: string, idx: number) => {
                            navigator.clipboard.writeText(text).then(() => {
                                setCopiedIdx(idx);
                                setTimeout(() => setCopiedIdx(null), 2000);
                            });
                        };

                        const parseCsvToRows = (csvText: string): Record<string, unknown>[] => {
                            const raw = csvText.replace(/^```(?:csv|json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
                            const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
                            if (lines.length < 2) return [];
                            const parseCsvRow = (line: string): string[] => {
                                const values: string[] = [];
                                let current = "";
                                let inQuotes = false;
                                for (let i = 0; i < line.length; i++) {
                                    const ch = line[i];
                                    if (ch === '"') {
                                        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
                                        else { inQuotes = !inQuotes; }
                                    } else if (ch === "," && !inQuotes) {
                                        values.push(current); current = "";
                                    } else {
                                        current += ch;
                                    }
                                }
                                values.push(current);
                                return values.map((v) => v.trim());
                            };
                            const headers = parseCsvRow(lines[0]);
                            const rows: Record<string, unknown>[] = [];
                            for (let li = 1; li < lines.length; li++) {
                                const values = parseCsvRow(lines[li]);
                                const row: Record<string, unknown> = {};
                                headers.forEach((h, i) => { if (h) row[h] = values[i] ?? ""; });
                                rows.push(row);
                            }
                            return rows;
                        };

                        // ── Freetext-like runs (generate or process-documents non-CSV) ──
                        const isFreetextGenerate = run.runType === "generate" && fmt && fmt.ext !== "csv" && fmt.ext !== "json" &&
                            rawResults.length === 1 && typeof rawResults[0].output === "string" && rawResults[0].output.length > 0;

                        const isJsonGenerate = run.runType === "generate" && rawResults.length > 0 && fmt?.ext === "json";

                        const isProcessDocs = run.runType === "process-documents";
                        const isProcessDocsCsv = isProcessDocs && fmt?.ext === "csv";
                        const isProcessDocsText = isProcessDocs && !isProcessDocsCsv;

                        // ── Process-documents CSV → parse into proper table columns ──
                        if (isProcessDocsCsv && rawResults.length > 0) {
                            const tableRows: Record<string, unknown>[] = [];
                            for (const r of rawResults) {
                                if (r.status !== "success" || !r.output) continue;
                                const input = JSON.parse(r.inputJson ?? "{}");
                                const docName = (input.document_name as string) ?? "Document";
                                const parsed = parseCsvToRows(r.output as string);
                                for (const row of parsed) {
                                    tableRows.push({ document_name: docName, ...row });
                                }
                            }
                            if (tableRows.length > 0) {
                                return (
                                    <div>
                                        <div className="px-4 py-2.5 border border-b-0 rounded-t-lg bg-muted/20 text-sm font-medium flex items-center justify-between flex-wrap gap-2">
                                            <span>Processed Documents — {rawResults.filter((r) => r.status === "success").length} file{rawResults.filter((r) => r.status === "success").length !== 1 ? "s" : ""} — {tableRows.length} rows</span>
                                            <ExportDropdown data={tableRows} filename="run_results" />
                                        </div>
                                        <div className="border rounded-b-lg">
                                            <DataTable data={tableRows} />
                                        </div>
                                    </div>
                                );
                            }
                        }

                        // ── Freetext output (generate or process-documents non-CSV) ──
                        if ((isFreetextGenerate || isJsonGenerate || isProcessDocsText) && rawResults.length > 0 && fmt) {
                            // Build per-entry blocks from raw results
                            const entries = rawResults
                                .filter((r) => r.status === "success" && r.output)
                                .map((r) => {
                                    const input = JSON.parse(r.inputJson ?? "{}");
                                    const name = isProcessDocs
                                        ? ((input.document_name as string) ?? "Document")
                                        : ((input.description as string) ?? "Generated");
                                    return { name, output: r.output as string };
                                });

                            // For JSON generate with multiple batched results, reconstruct array
                            let combinedRaw: string;
                            if (isJsonGenerate && rawResults.length > 1) {
                                const rows = rawResults
                                    .filter((r) => r.status === "success" && r.output)
                                    .map((r) => { try { return JSON.parse(r.output as string); } catch { return r.output; } });
                                combinedRaw = JSON.stringify(rows, null, 2);
                            } else if (entries.length === 1) {
                                combinedRaw = entries[0].output;
                            } else {
                                combinedRaw = entries.map((e) => `=== ${e.name} ===\n\n${e.output}`).join("\n\n---\n\n");
                            }

                            const headerLabel = isProcessDocs
                                ? `Processed Documents — ${entries.length} file${entries.length !== 1 ? "s" : ""} — ${fmt.label}`
                                : `Generated Output — ${fmt.label}`;

                            return (
                                <div className="border rounded-lg overflow-hidden">
                                    <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium flex items-center justify-between flex-wrap gap-2">
                                        <span>{headerLabel}</span>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => copyToClipboard(combinedRaw, -1)}
                                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                            >
                                                {copiedIdx === -1 ? (
                                                    <><Check className="h-3 w-3 text-green-600" /> Copied</>
                                                ) : (
                                                    <><Copy className="h-3 w-3" /> Copy</>
                                                )}
                                            </button>
                                            <Button variant="outline" size="sm" className="text-xs" onClick={() => {
                                                const blob = new Blob([combinedRaw], { type: "text/plain;charset=utf-8;" });
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement("a"); a.href = url; a.download = `${isProcessDocs ? "processed_documents" : `generated_${run.id}`}.${fmt.ext}`; a.click();
                                                URL.revokeObjectURL(url);
                                            }}>
                                                <Download className="h-3.5 w-3.5 mr-1.5" /> Download .{fmt.ext}
                                            </Button>
                                        </div>
                                    </div>
                                    <pre className={`p-4 text-sm whitespace-pre-wrap bg-muted/10 leading-relaxed ${fmt.font}`}>
                                        {combinedRaw}
                                    </pre>
                                </div>
                            );
                        }

                        return (
                            <div>
                                <div className="px-4 py-2.5 border border-b-0 rounded-t-lg bg-muted/20 text-sm font-medium flex items-center justify-between flex-wrap gap-2">
                                    <span>Processed Results — {results.length} rows</span>
                                    <ExportDropdown data={results} filename="run_results" />
                                </div>
                                <div className="border rounded-b-lg">
                                    <DataTable data={results} />
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </div>

            <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Run?</DialogTitle>
                        <DialogDescription>
                            This will permanently delete this run and all its results. This cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowDeleteDialog(false)} disabled={isDeleting}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                            {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function Label({ children }: { children: React.ReactNode }) {
    return <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">{children}</div>;
}

function Separator() {
    return <div className="h-px bg-muted w-full my-1" />;
}
