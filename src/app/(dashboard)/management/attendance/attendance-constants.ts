// Shared by the charts, the drill-down dialog and the shell. Kept out of
// AttendanceCharts.tsx so importing them doesn't pull recharts into the
// first-paint bundle (the charts themselves load lazily).

import type { AttendanceDayPerson } from "@/lib/timesheets/attendance";
import { fmtTime } from "@/components/shared/format";
import { formatClockTime } from "@/lib/timesheets/schedule";

// Fixed status colours (readable on light and dark): the same status is
// always the same colour on every chart and badge.
export const STATUS_COLOR = {
  on_time: "#16a34a",
  late: "#f59e0b",
  absent: "#dc2626",
  not_in: "#dc2626",
  time_off: "#3b82f6",
  overtime: "#8b5cf6",
} as const;

export const DAY_GROUPS: { status: AttendanceDayPerson["status"]; label: string }[] = [
  { status: "late", label: "Late" },
  { status: "not_in", label: "Not in yet" },
  { status: "absent", label: "Didn't clock in" },
  { status: "time_off", label: "Time off" },
  { status: "on_time", label: "On time / early" },
];

export function arrivalNote(p: AttendanceDayPerson): string {
  if (p.status === "not_in") return p.scheduled ? `shift started ${formatClockTime(p.scheduled)}` : "";
  if (p.status === "absent") return p.scheduled ? `due ${formatClockTime(p.scheduled)}` : "";
  if (p.status === "time_off") return "full day";
  const time = p.at ? fmtTime(p.at) : "";
  if (p.status === "late") return `${time} · ${p.minutes} min late`;
  if (p.partial_off) return `${time} · partial day off`;
  return p.minutes <= -1 ? `${time} · ${-p.minutes} min early` : `${time} · on time`;
}
