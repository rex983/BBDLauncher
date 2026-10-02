// Display formatters shared by feature components. `[]` locale = the
// viewer's own; the "US" variants always render en-US.

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
const SHORT_DATE_TIME: Intl.DateTimeFormatOptions = { ...SHORT_DATE, hour: "numeric", minute: "2-digit" };

// YYYY-MM-DD calendar day → "Sep 16, 2026".
export function fmtDay(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString([], SHORT_DATE);
}

// ISO timestamp → "Sep 16, 2026, 3:04 PM".
export function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString([], SHORT_DATE_TIME);
}

// ISO timestamp → "3:04 PM".
export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function fmtDateUS(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", SHORT_DATE);
}

export function fmtDateTimeUS(iso: string) {
  return new Date(iso).toLocaleString("en-US", SHORT_DATE_TIME);
}

export function fmtLongDateTimeUS(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
}

// "just now" / "5m ago" / "3h ago" / "2d ago"; 30+ days falls back to `older`.
export function fmtRelative(iso: string, older: (iso: string) => string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return older(iso);
}

// Local wall-clock value for <input type="datetime-local"> (YYYY-MM-DDTHH:MM).
export function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
