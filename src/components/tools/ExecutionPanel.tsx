"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Play, X } from "lucide-react";

type RunMode = "preview" | "test" | "full";

interface ExecutionPanelProps {
  isProcessing: boolean;
  /** True between Stop click and in-flight rows finishing */
  aborting?: boolean;
  runMode: RunMode;
  progress: { completed: number; total: number };
  etaStr?: string;
  dataCount: number;
  disabled?: boolean;
  onRun: (mode: RunMode) => void;
  onAbort: () => void;
  /** Called when "Resume" is clicked (retries failed + skipped rows). */
  onResume?: () => void;
  /** Called when "Cancel" is clicked (discards all results). */
  onCancel?: () => void;
  /** Number of failed rows from previous run. */
  failedCount?: number;
  /** Number of rows skipped due to Stop. */
  skippedCount?: number;
  progressColor?: string;
  showSuccessErrors?: boolean;
  successCount?: number;
  errorCount?: number;
  testLabel?: string;
  fullLabel?: string;
  /** Label for data items — defaults to "rows" (use "files" for document tools). */
  unitLabel?: string;
  children?: React.ReactNode;
}

export function ExecutionPanel({
  isProcessing,
  aborting = false,
  runMode,
  progress,
  etaStr,
  dataCount,
  disabled = false,
  onRun,
  onAbort,
  onResume,
  onCancel,
  failedCount = 0,
  skippedCount = 0,
  progressColor = "bg-black dark:bg-white",
  showSuccessErrors = false,
  successCount = 0,
  errorCount = 0,
  testLabel,
  fullLabel,
  unitLabel = "rows",
  children,
}: ExecutionPanelProps) {
  const progressPct =
    progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  const modeLabel =
    runMode !== "full"
      ? (runMode === "preview" ? "Preview" : "Test") + " run"
      : "Full run";

  const incompleteCount = failedCount + skippedCount;
  const completedOk = progress.total - incompleteCount;

  // Stopped state: not processing but has incomplete rows to resume/cancel
  const isStopped = !isProcessing && onResume && incompleteCount > 0;

  return (
    <div className="space-y-4">
      {/* ── Active processing OR stopped state — both show the progress bar ── */}
      {(isProcessing || isStopped) && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground flex-wrap gap-1">
            <span className="flex items-center gap-1.5">
              {isProcessing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {aborting
                    ? "Stopping — waiting for in-flight rows..."
                    : `${modeLabel} — processing ${progress.total} ${unitLabel}...`}
                  {!aborting && etaStr && (
                    <span className="text-muted-foreground ml-1">{etaStr}</span>
                  )}
                </>
              ) : (
                <>
                  Stopped — {completedOk} of {progress.total} completed
                  {failedCount > 0 && (
                    <span className="text-red-500 ml-1">({failedCount} errors)</span>
                  )}
                </>
              )}
            </span>
            <div className="flex items-center gap-2">
              {isProcessing && (
                <span>
                  {progress.completed} / {progress.total}
                </span>
              )}
              {/* Stop button — while processing and not already aborting */}
              {isProcessing && !aborting && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAbort}
                  className="h-6 px-2 text-[11px] border-red-300 text-red-600 hover:bg-red-50"
                >
                  Stop
                </Button>
              )}
              {/* Resume / Cancel — small inline buttons after stop */}
              {isStopped && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={onResume}
                    className="h-6 px-2 text-[11px] border-green-300 text-green-700 hover:bg-green-50"
                  >
                    <Play className="h-3 w-3 mr-1" />
                    Resume ({incompleteCount} {unitLabel})
                  </Button>
                  {onCancel && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onCancel}
                      className="h-6 px-2 text-[11px] border-muted-foreground/30 text-muted-foreground hover:bg-muted"
                    >
                      <X className="h-3 w-3 mr-1" />
                      Cancel
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
            <div
              className={`${
                isStopped ? "bg-amber-400" : aborting ? "bg-amber-400" : progressColor
              } h-full transition-all duration-300`}
              style={{ width: `${isStopped && progress.total > 0 ? Math.round((completedOk / progress.total) * 100) : progressPct}%` }}
            />
          </div>
          {showSuccessErrors && (
            <div className="flex gap-4 text-xs">
              <span className="text-green-600">{successCount} success</span>
              <span className="text-red-500">{errorCount} errors</span>
            </div>
          )}
        </div>
      )}

      {children}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Button
          variant="outline"
          size="lg"
          className="h-12 text-base"
          disabled={disabled || isProcessing}
          onClick={() => onRun("test")}
        >
          {isProcessing && runMode === "test" ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : null}
          {testLabel ?? `Test (${Math.min(10, dataCount)} ${unitLabel})`}
        </Button>
        <Button
          size="lg"
          className="h-12 text-base bg-red-500 hover:bg-red-600 text-white"
          disabled={disabled || isProcessing}
          onClick={() => onRun("full")}
        >
          {isProcessing && runMode === "full" ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : null}
          {fullLabel ?? `Full Run (${dataCount} ${unitLabel})`}
        </Button>
      </div>
    </div>
  );
}
