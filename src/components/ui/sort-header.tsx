"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import type { SortState } from "@/lib/hooks/use-sortable-rows";

// Clickable TableHead that shows the current sort direction. Wrap around a
// useSortableRows() key for zero-boilerplate sortable columns.
export function SortHeader<K extends string>({
  columnKey,
  label,
  sort,
  onToggle,
  align = "left",
  className,
}: {
  columnKey: K;
  label: string;
  sort: SortState<K>;
  onToggle: (key: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === columnKey;
  const Icon = !active ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={`${align === "right" ? "text-right" : ""} ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => onToggle(columnKey)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          active ? "text-foreground" : "text-muted-foreground"
        } ${align === "right" ? "float-right" : ""}`}
      >
        {label}
        <Icon className="h-3 w-3 opacity-70" />
      </button>
    </TableHead>
  );
}
