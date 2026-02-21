"use client";

import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface FileUploaderProps {
    onDataLoaded: (data: any[], fileName: string) => void;
    accept?: Record<string, string[]>;
}

export function FileUploader({ onDataLoaded, accept }: FileUploaderProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        if (!file) return;

        setIsProcessing(true);
        setError(null);

        const reader = new FileReader();

        reader.onload = (e) => {
            const result = e.target?.result;
            if (!result) return;

            try {
                const fileExt = file.name.split(".").pop()?.toLowerCase();

                if (fileExt === "csv") {
                    Papa.parse(result as string, {
                        header: true,
                        skipEmptyLines: true,
                        complete: (results) => {
                            onDataLoaded(results.data, file.name);
                            setIsProcessing(false);
                        },
                        error: (err: any) => {
                            setError(`Error parsing CSV: ${err.message}`);
                            setIsProcessing(false);
                        },
                    });
                } else if (fileExt === "xlsx" || fileExt === "xls") {
                    const workbook = XLSX.read(result, { type: "binary" });
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const data = XLSX.utils.sheet_to_json(worksheet);
                    onDataLoaded(data, file.name);
                    setIsProcessing(false);
                } else if (fileExt === "json") {
                    const data = JSON.parse(result as string);
                    onDataLoaded(Array.isArray(data) ? data : [data], file.name);
                    setIsProcessing(false);
                }
            } catch (err: any) {
                setError(`Failed to process file: ${err.message}`);
                setIsProcessing(false);
            }
        };

        if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
            reader.readAsBinaryString(file);
        } else {
            reader.readAsText(file);
        }
    }, [onDataLoaded]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: accept || {
            "text/csv": [".csv"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
            "application/vnd.ms-excel": [".xls"],
            "application/json": [".json"],
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
                            Support for CSV, Excel, and JSON files
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
