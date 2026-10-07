// Client-safe: AttendanceShell needs these, and attendance.ts pulls in
// server-only auth code.
export const ATTENDANCE_RANGES = [1, 7, 14, 30, 90] as const; // 1 = today
export type AttendanceRange = (typeof ATTENDANCE_RANGES)[number];
