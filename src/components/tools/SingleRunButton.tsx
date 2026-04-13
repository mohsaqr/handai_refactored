"use client";

import React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  label: string;
  runningLabel?: string;
  isProcessing: boolean;
  aborting?: boolean;
  disabled?: boolean;
  onRun: () => void;
  onAbort?: () => void;
}

export function SingleRunButton({
  label,
  runningLabel = "Processing…",
  isProcessing,
  aborting = false,
  disabled = false,
  onRun,
  onAbort,
}: Props) {
  return (
    <div className="space-y-3">
      {isProcessing && onAbort && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{aborting ? "Aborting…" : runningLabel}</span>
            <Button variant="outline" size="sm" onClick={onAbort} disabled={aborting}>
              Stop
            </Button>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
            <div
              className={`${aborting ? "bg-amber-400" : "bg-black dark:bg-white"} h-full animate-pulse`}
              style={{ width: "60%" }}
            />
          </div>
        </div>
      )}
      <Button
        size="lg"
        className="w-full h-12 text-base bg-red-500 hover:bg-red-600 text-white"
        disabled={disabled || isProcessing}
        onClick={onRun}
      >
        {isProcessing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
        {isProcessing ? runningLabel : label}
      </Button>
    </div>
  );
}
