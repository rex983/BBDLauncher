"use client";

import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export interface SortState<K extends string = string> {
  key: K;
  direction: SortDirection;
}

// Generic column-based sort. Pass a getter map keyed by column id; clicking
// a header cycles asc → desc → asc for that column. Comparison is stable
// (Array.prototype.sort is stable in modern engines) and null/undefined
// values are pushed to the end regardless of direction so empty cells don't
// crowd the top of the table.
export function useSortableRows<T, K extends string>(
  rows: T[],
  getters: Record<K, (row: T) => string | number | Date | null | undefined>,
  initial: SortState<K>,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);

  const sorted = useMemo(() => {
    const getter = getters[sort.key];
    if (!getter) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      // Null/undefined always sink.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av instanceof Date && bv instanceof Date) {
        return (av.getTime() - bv.getTime()) * factor;
      }
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * factor;
      }
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [rows, sort, getters]);

  const toggle = (key: K) => {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "desc" },
    );
  };

  return { sorted, sort, toggle };
}
