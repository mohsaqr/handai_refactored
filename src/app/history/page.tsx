"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  History,
  Search,
  Calendar,
  Clock,
  BarChart2,
  ArrowRight,
  Play,
  Loader2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import Link from "next/link";
import type { RunMeta } from "@/types";
import { listRuns as idbListRuns, deleteRun as idbDeleteRun } from "@/lib/db-indexeddb";
import { useBrowserStorage } from "@/lib/llm-dispatch";
import RunDetailClient from "./[id]/RunDetailClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Stats {
  totalSessions: number;
  totalRuns: number;
  totalSuccess: number;
  totalError: number;
}

const PAGE_SIZE = 20;

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms < 60000
    ? `${Math.round(ms / 1000)}s`
    : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function HistoryContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const detailId = searchParams.get("id");

  const useBrowserDb = useBrowserStorage;
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [stats, setStats] = useState<Stats>({ totalSessions: 0, totalRuns: 0, totalSuccess: 0, totalError: 0 });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchRuns = async (pageNum = 0) => {
    setIsRefreshing(true);
    try {
      const offset = pageNum * PAGE_SIZE;
      if (useBrowserDb) {
        const data = await idbListRuns(PAGE_SIZE, offset);
        setRuns(data.runs as RunMeta[]);
        setTotal(data.total ?? 0);
        if (data.stats) setStats(data.stats);
      } else {
        const res = await fetch(`/api/runs?limit=${PAGE_SIZE}&offset=${offset}`);
        if (!res.ok) throw new Error(`Failed to fetch runs: ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          setRuns(data as RunMeta[]);
          setTotal(data.length);
        } else {
          setRuns(data.runs as RunMeta[]);
          setTotal(data.total ?? 0);
          if (data.stats) setStats(data.stats);
        }
      }
      setPage(pageNum);
    } catch {
      toast.error("Failed to load history");
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchRuns(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uniqueProviders = [...new Set(runs.map((r) => r.provider).filter(Boolean))].sort();

  const filteredRuns = runs.filter(
    (run) =>
      (run.inputFile?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        run.runType?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        run.model?.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (statusFilter === "all" || run.status === statusFilter) &&
      (providerFilter === "all" || run.provider === providerFilter)
  );

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    setIsDeleting(true);
    try {
      if (useBrowserDb) {
        const result = await idbDeleteRun(confirmDeleteId);
        if (!result.ok) throw new Error("Delete failed");
      } else {
        const res = await fetch(`/api/runs/${confirmDeleteId}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Delete failed");
      }
      toast.success("Run deleted");
      setRuns((prev) => prev.filter((r) => r.id !== confirmDeleteId));
      setTotal((prev) => prev - 1);
    } catch {
      toast.error("Failed to delete run");
    } finally {
      setIsDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  const navigateToDetail = (id: string) => {
    if (useBrowserDb) {
      router.push(`/history?id=${id}`);
    } else {
      router.push(`/history/${id}`);
    }
  };

  // In static builds, show the detail view inline when ?id= param is present
  if (detailId) {
    return <RunDetailClient id={detailId} />;
  }

  return (
    <div className="space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 flex items-start justify-between">
        <div className="space-y-1 max-w-3xl">
          <h1 className="text-4xl font-bold">History</h1>
          <p className="text-muted-foreground text-sm">Review past processing sessions and results</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchRuns(page)}
          disabled={isRefreshing}
          className="mt-1"
        >
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <BarChart2 className="h-4 w-4 mr-2" />
          )}
          Refresh
        </Button>
      </div>

      {/* Stats Dashboard */}
      <div className="pb-6 grid grid-cols-3 gap-4">
        <Card className="py-4">
          <CardContent className="flex items-center gap-3 px-4">
            <div className="h-9 w-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center shrink-0">
              <Users className="h-4 w-4 text-indigo-600" />
            </div>
            <div>
              <p className="text-2xl font-bold leading-none">{stats.totalSessions}</p>
              <p className="text-xs text-muted-foreground mt-1">Sessions</p>
            </div>
          </CardContent>
        </Card>
        <Card className="py-4">
          <CardContent className="flex items-center gap-3 px-4">
            <div className="h-9 w-9 rounded-lg bg-violet-50 dark:bg-violet-950/30 flex items-center justify-center shrink-0">
              <BarChart2 className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <p className="text-2xl font-bold leading-none">{stats.totalRuns}</p>
              <p className="text-xs text-muted-foreground mt-1">Total Runs</p>
            </div>
          </CardContent>
        </Card>
        <Card className="py-4">
          <CardContent className="px-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Success Rate</p>
              <p className="text-sm font-bold">
                {stats.totalSuccess + stats.totalError > 0
                  ? `${Math.round((stats.totalSuccess / (stats.totalSuccess + stats.totalError)) * 100)}%`
                  : "N/A"}
              </p>
            </div>
            <Progress
              value={
                stats.totalSuccess + stats.totalError > 0
                  ? (stats.totalSuccess / (stats.totalSuccess + stats.totalError)) * 100
                  : 0
              }
            />
            <p className="text-[10px] text-muted-foreground">
              {stats.totalSuccess} succeeded, {stats.totalError} failed
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search + Filters */}
      <div className="pb-6 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by file, model, or type..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={providerFilter} onValueChange={setProviderFilter}>
          <SelectTrigger className="w-36 text-xs">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {uniqueProviders.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Runs table */}
      <div className="border rounded-lg overflow-hidden">
        {filteredRuns.length === 0 && !isRefreshing ? (
          <div className="py-16 flex flex-col items-center justify-center text-center space-y-4">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <History className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold">No history found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Runs will appear here after you process your first batch of data.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/">Explore Tools</Link>
            </Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_0_var(--color-border)]">
              <tr>
                <th className="text-left font-bold px-4 py-2.5 select-none">Status</th>
                <th className="text-left font-bold px-4 py-2.5 select-none">File</th>
                <th className="text-left font-bold px-4 py-2.5 select-none">Tool</th>
                <th className="text-left font-bold px-4 py-2.5 select-none">Model</th>
                <th className="text-left font-bold px-4 py-2.5 select-none">Date</th>
                <th className="text-left font-bold px-4 py-2.5 select-none">Duration</th>
                <th className="text-left font-bold px-4 py-2.5 select-none">Rows</th>
                <th className="text-left font-bold px-4 py-2.5 select-none">Results</th>
                <th className="text-left font-bold px-4 py-2.5 select-none">Avg Latency</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run, i) => (
                <tr
                  key={run.id}
                  onClick={() => navigateToDetail(run.id)}
                  className={`group cursor-pointer border-t hover:bg-muted/40 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                >
                  <td className="px-4 py-2.5">
                    <div
                      className={`h-7 w-7 rounded-md flex items-center justify-center ${
                        run.status === "completed"
                          ? "bg-green-50 dark:bg-green-950/30 text-green-600"
                          : "bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600"
                      }`}
                    >
                      {run.status === "completed" ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-medium max-w-[200px] truncate">{run.inputFile}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline" className="text-[10px] capitalize px-1.5 py-0">
                      {run.runType}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {run.provider}/{run.model}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
                    {new Date(run.startedAt).toLocaleDateString()}{" "}
                    {new Date(run.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {run.completedAt ? formatDuration(run.startedAt, run.completedAt) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{run.inputRows}</td>
                  <td className="px-4 py-2.5 text-xs">
                    <span className="text-green-600 font-medium">{run.successCount}</span>
                    {" / "}
                    <span className={run.errorCount > 0 ? "text-red-500 font-medium" : "text-muted-foreground"}>{run.errorCount}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {run.avgLatency ? `${(run.avgLatency / 1000).toFixed(2)}s` : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(run.id); }}
                        className="h-7 w-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-500"
                        title="Delete run"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <div className="h-7 w-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!confirmDeleteId} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Run?</DialogTitle>
            <DialogDescription>
              This will permanently delete this run and all its results. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between pt-6">
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages} &mdash; {total} total runs
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchRuns(page - 1)}
              disabled={!hasPrev || isRefreshing}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchRuns(page + 1)}
              disabled={!hasNext || isRefreshing}
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        </div>
      }
    >
      <HistoryContent />
    </Suspense>
  );
}
