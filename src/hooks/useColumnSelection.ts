"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import { useSessionState } from "./useSessionState";

/**
 * Manages column selection state, persisted to sessionStorage.
 * Auto-selects all columns when new data is loaded (columns change).
 *
 * @param storageKey — unique sessionStorage key per tool (e.g. "transform_selectedCols")
 * @param allColumns — current column names from loaded data
 * @param defaultSelectAll — whether to auto-select all columns when data loads (default true)
 */
export function useColumnSelection(
  storageKey: string,
  allColumns: string[],
  defaultSelectAll = true,
): {
  selectedCols: string[];
  setSelectedCols: Dispatch<SetStateAction<string[]>>;
  toggleCol: (col: string) => void;
  toggleAll: () => void;
} {
  const [selectedCols, setSelectedCols] = useSessionState<string[]>(storageKey, []);

  // Called by the page when new data is loaded — sets initial selection
  const handleColumnsChanged = useCallback(
    (cols: string[]) => {
      if (cols.length > 0) {
        setSelectedCols(defaultSelectAll ? [...cols] : []);
      }
    },
    [defaultSelectAll, setSelectedCols]
  );

  // Auto-select when allColumns changes (new data loaded) and nothing is selected yet
  // Only trigger when the column set actually changes, not on every render
  const colKey = allColumns.join(",");
  const [prevColKey, setPrevColKey] = useSessionState(storageKey + "_colKey", "");
  if (colKey && colKey !== prevColKey) {
    // Columns changed — new data was loaded
    setPrevColKey(colKey);
    // Only auto-select if no selection exists (preserve user's choices on navigation)
    if (selectedCols.length === 0 || !selectedCols.every((c) => allColumns.includes(c))) {
      handleColumnsChanged(allColumns);
    }
  }

  const toggleCol = (col: string) =>
    setSelectedCols((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );

  const toggleAll = () =>
    setSelectedCols(
      selectedCols.length === allColumns.length ? [] : [...allColumns]
    );

  return { selectedCols, setSelectedCols, toggleCol, toggleAll };
}
