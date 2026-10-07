// Client-safe: AttendanceShell needs these, and attendance.ts pulls in
// server-only auth code.
export const ATTENDANCE_RANGES = [7, 14, 30, 90] as const;
export type AttendanceRange = (typeof ATTENDANCE_RANGES)[number];
