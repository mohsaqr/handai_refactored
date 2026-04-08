"use client";

import React, { useState, useEffect } from "react";
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
} from "lucide-react";
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
import { getRun as idbGetRun, deleteRun as idbDeleteRun } from "@/lib/db-indexeddb";
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
    const setPendingRestore = useRestoreStore((s) => s.setPending);

    const buildResultRow = (r: RunResult) => {
        const input = JSON.parse(r.inputJson ?? "{}");
        const hasAiOutput = Object.keys(input).some((k) => k.startsWith("ai_output"));

        // If output is a JSON object (e.g. automator), spread its fields instead of adding an "output" column
        let outputFields: Record<string, unknown> = {};
        if (!hasAiOutput && r.output) {
            if (typeof r.output === "string") {
                try {
                    const parsed = JSON.parse(r.output);
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                        outputFields = parsed;
                    } else {
                        outputFields = { output: r.output };
                    }
                } catch {
                    outputFields = { output: r.output };
                }
            } else if (typeof r.output === "object") {
                outputFields = r.output as Record<string, unknown>;
            }
        }

        return {
            ...input,
            ...outputFields,
            status: r.status,
            latency_ms: Math.round((r.latency ?? 0) * 1000),
            ...(r.errorMessage ? { error_message: r.errorMessage } : {}),
        };
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
                    setResults(typedResults.map(buildResultRow));
                } else {
                    const res = await fetch(`/api/runs/${id}`);
                    const data = await res.json();
                    if (data.error) throw new Error(data.error);
                    setRun(data.run);
                    setRawResults(data.results);
                    setResults(data.results.map(buildResultRow));
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

    const handleRestore = () => {
        if (!run || rawResults.length === 0) return;

        // Reconstruct original data rows from inputJson
        const data = rawResults.map((r: RunResult) => JSON.parse(r.inputJson ?? "{}"));

        // Build merged result rows (same shape tool pages expect)
        const mergedResults = rawResults.map((r: RunResult) => {
            const input = JSON.parse(r.inputJson ?? "{}");
            const hasAiOutput = Object.keys(input).some((k) => k.startsWith("ai_output"));

            let outputFields: Record<string, unknown> = {};
            if (!hasAiOutput && r.output) {
                if (typeof r.output === "string") {
                    try {
                        const parsed = JSON.parse(r.output);
                        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
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
        "ai-coder", "codebook-generator",
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
                            <h1 className="text-xl font-bold">{run.inputFile}</h1>
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

                <div className="md:col-span-4 min-w-0 overflow-hidden">
                    <div className="border rounded-lg overflow-hidden">
                        <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium flex items-center justify-between flex-wrap gap-2">
                            <span>Processed Results — {results.length} rows</span>
                            <ExportDropdown data={results} filename="run_results" />
                        </div>
                        <DataTable data={results} />
                    </div>
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
