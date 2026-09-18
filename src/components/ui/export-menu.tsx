"use client";

import { Download, FileJson, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  downloadBlob,
  exportFilename,
  rowsToCsv,
  rowsToJson,
  type ExportColumn,
} from "@/lib/export/csv";

// Reusable "Export" button: dumps the current row set as CSV / JSON or
// triggers a browser print (used for PDF via "Save as PDF"). Callers pass
// filtered/sorted rows so exports match what's on-screen.
export function ExportMenu<T>({
  filename,
  rows,
  columns,
  size = "sm",
  variant = "outline",
  disabled,
  className,
}: {
  filename: string;
  rows: T[];
  columns: ExportColumn<T>[];
  size?: "sm" | "default" | "icon";
  variant?: "default" | "outline" | "ghost" | "secondary";
  disabled?: boolean;
  className?: string;
}) {
  const nothingToExport = disabled || rows.length === 0;

  const onCsv = () => {
    const csv = rowsToCsv(rows, columns);
    downloadBlob(csv, exportFilename(filename, "csv"), "text/csv");
  };
  const onJson = () => {
    const json = rowsToJson(rows, columns);
    downloadBlob(json, exportFilename(filename, "json"), "application/json");
  };
  const onPrint = () => window.print();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={nothingToExport}
          className={`print:hidden ${className ?? ""}`}
        >
          <Download className="h-4 w-4" />
          <span className={size === "icon" ? "sr-only" : "ml-2"}>Export</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {rows.length.toLocaleString()} {rows.length === 1 ? "row" : "rows"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCsv}>
          <FileSpreadsheet className="h-4 w-4" />
          CSV / Excel
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onJson}>
          <FileJson className="h-4 w-4" />
          JSON
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onPrint}>
          <Printer className="h-4 w-4" />
          Print / Save as PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
