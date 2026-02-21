"use client";

import React, { useState, useEffect } from "react";
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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import Link from "next/link";
import type { RunMeta } from "@/types";

const PAGE_SIZE = 20;

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms < 60000
    ? `${Math.round(ms / 1000)}s`
    : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");

  const fetchRuns = async (pageNum = 0) => {
    setIsRefreshing(true);
    try {
      const offset = pageNum * PAGE_SIZE;
      const res = await fetch(`/api/runs?limit=${PAGE_SIZE}&offset=${offset}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setRuns(data as RunMeta[]);
        setTotal(data.length);
      } else {
        setRuns(data.runs as RunMeta[]);
        setTotal(data.total ?? 0);
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

  return (
    <div className="max-w-4xl mx-auto space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 flex items-start justify-between">
        <div className="space-y-1">
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

      {/* Runs list */}
      <div className="space-y-2">
        {filteredRuns.length === 0 && !isRefreshing && (
          <div className="border border-dashed rounded-xl py-16 flex flex-col items-center justify-center text-center space-y-4">
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
        )}

        {filteredRuns.map((run) => (
          <Link key={run.id} href={`/history/${run.id}`}>
            <div className="group flex items-center p-4 gap-4 rounded-xl border bg-card hover:border-indigo-300 dark:hover:border-indigo-700 transition-all duration-150 hover:shadow-sm">
              <div
                className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
                  run.status === "completed"
                    ? "bg-green-50 dark:bg-green-950/30 text-green-600"
                    : "bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600"
                }`}
              >
                {run.status === "completed" ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold truncate text-sm">{run.inputFile}</span>
                  <Badge variant="outline" className="text-[10px] capitalize px-1 py-0 shrink-0">
                    {run.runType}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                    {run.provider}/{run.model}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {new Date(run.startedAt).toLocaleDateString()}
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(run.startedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  {run.completedAt && (
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(run.startedAt, run.completedAt)}
                    </div>
                  )}
                  <span className="font-medium text-foreground">
                    {run.successCount} Success / {run.errorCount} Error
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right hidden sm:block">
                  <div className="text-[10px] font-medium text-foreground">
                    {run.avgLatency ? `${(run.avgLatency / 1000).toFixed(2)}s avg` : "N/A"}
                  </div>
                  <div className="text-[9px] text-muted-foreground">{run.inputRows} rows</div>
                </div>
                <div className="h-8 w-8 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground">
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

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
