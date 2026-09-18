// Tiny CSV/JSON export helpers. Kept dep-free so we don't ship a spreadsheet
// library to the browser just to save a few tables — Excel and Google Sheets
// both open CSV without prompting.

export interface ExportColumn<T> {
  key: string;
  label: string;
  get: (row: T) => string | number | boolean | null | undefined | Date;
}

function serializeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

// Excel-safe CSV escape: quote when the value contains comma, quote, newline,
// or a leading = (formula injection protection).
function escapeCsvCell(value: string): string {
  const needsQuoting = /[",\r\n]|^=/.test(value);
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function rowsToCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(",");
  const body = rows
    .map((row) =>
      columns
        .map((c) => escapeCsvCell(serializeCell(c.get(row))))
        .join(","),
    )
    .join("\r\n");
  return body ? `${header}\r\n${body}\r\n` : `${header}\r\n`;
}

export function rowsToJson<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const out = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const c of columns) {
      const v = c.get(row);
      obj[c.key] = v instanceof Date ? v.toISOString() : v ?? null;
    }
    return obj;
  });
  return JSON.stringify(out, null, 2);
}

export function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Timestamped filename helper — "analytics-apps-30d-2026-09-18.csv"
export function exportFilename(base: string, ext: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${base}-${stamp}.${ext}`;
}
