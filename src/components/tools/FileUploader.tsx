"use client";

import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { parseStructuredFile, getFileExt } from "@/lib/parse-file";

interface FileUploaderProps {
    onDataLoaded: (data: Record<string, unknown>[], fileName: string) => void;
    accept?: Record<string, string[]>;
}

export function FileUploader({ onDataLoaded, accept }: FileUploaderProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        if (!file) return;

        setIsProcessing(true);
        setError(null);

        try {
            const rows = await parseStructuredFile(file);
            if (!rows) {
                const ext = getFileExt(file.name);
                setError(ext === "ris" ? "No valid records found in RIS file" : `Failed to parse .${ext} file`);
                setIsProcessing(false);
                return;
            }
            onDataLoaded(rows, file.name);
        } catch (err: unknown) {
            setError(`Failed to process file: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setIsProcessing(false);
        }
    }, [onDataLoaded]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: accept || {
            "text/csv": [".csv"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
            "application/vnd.ms-excel": [".xls"],
            "application/json": [".json"],
            "application/x-research-info-systems": [".ris"],
            "text/plain": [".ris"],
        },
        multiple: false,
    });

    return (
        <div className="w-full">
            <Card
                {...getRootProps()}
                className={`border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"
                    } ${isProcessing ? "opacity-50 pointer-events-none" : ""}`}
            >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center justify-center space-y-4">
                    <div className="p-3 rounded-full bg-muted">
                        <Upload className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="space-y-1">
                        <p className="text-sm font-medium">
                            {isDragActive ? "Drop the file here" : "Click or drag file to upload"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Support for CSV, Excel, JSON, and RIS files
                        </p>
                    </div>
                    {isProcessing && (
                        <div className="text-sm animate-pulse text-primary">Processing...</div>
                    )}
                </div>
            </Card>
            {error && (
                <div className="mt-2 flex items-center text-sm text-destructive gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                </div>
            )}
        </div>
    );
}
