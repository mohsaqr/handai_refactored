"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SAMPLE_DATASETS } from "@/lib/sample-data";

interface Props {
  onSelect: (key: string) => void;
  label?: string;
}

export function SampleDatasetPicker({ onSelect, label = "Or load sample:" }: Props) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <Select onValueChange={(v) => { onSelect(v); }}>
        <SelectTrigger className="h-8 text-xs w-[220px]">
          <SelectValue placeholder="Select a dataset…" />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(SAMPLE_DATASETS).map(([key, ds]) => (
            <SelectItem key={key} value={key} className="text-xs">
              {ds.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
