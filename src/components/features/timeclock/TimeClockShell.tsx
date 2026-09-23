"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarCheck, Clock, Coffee, LogIn, LogOut } from "lucide-react";
import type { LiveState } from "@/lib/timesheets/state";
import {
  TIME_OFF_TYPE_LABEL,
  type TimeOffStatus,
  type TimeOffType,
} from "@/lib/timeoff/types";

interface ScheduleData {
  scheduled: boolean;
  end_of_day_iso: string | null;
  extension_until_iso: string | null;
  effective_end_iso: string | null;
}

interface MyTimeOffRow {
  id: string;
  type: TimeOffType;
  subcategory: string | null;
  start_date: string;
  end_date: string;
  full_day: boolean;
  hours: number | null;
  status: TimeOffStatus;
}

interface Props {
  children: React.ReactNode;
  // Server-fetched initial data so the shell renders immediately instead
  // of flashing a blank while three /api/timeclock/* round-trips resolve.
  // The client still refreshes on punches + focus so stale server data
  // self-corrects quickly.
  initialState?: LiveState | null;
  initialSchedule?: ScheduleData | null;
  initialUpcomingTimeOff?: MyTimeOffRow[];
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = new Date(start + "T00:00:00").toLocaleDateString([], opts);
  if (start === end) return s;
  const e = new Date(end + "T00:00:00").toLocaleDateString([], opts);
  return `${s} – ${e}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// v2 clock system.
//   * Clock In / Clock Out — client posts /api/timeclock/punch.
//   * Launcher app grid is blurred + unclickable when clocked out.
//   * T-5 min "keep working?" prompt lives in <ShiftEndPrompt> at the
//     (dashboard) layout level so it appears on every page, not just here.
//     No or ignore → the server's /api/cron/auto-clockout fires clock_out
//     at the scheduled time.
export function TimeClockShell({
  children,
  initialState = null,
  initialSchedule = null,
  initialUpcomingTimeOff = [],
}: Props) {
  const [state, setState] = useState<LiveState | null>(initialState);
  const [schedule, setSchedule] = useState<ScheduleData | null>(initialSchedule);
  // When we hydrate from server data we can skip the "…" loading placeholder
  // entirely and paint the correct clock-in / clocked-out state on the
  // first frame.
  const [loading, setLoading] = useState(initialState === null && initialSchedule === null);
  const [busy, setBusy] = useState(false);
  const [upcomingTimeOff, setUpcomingTimeOff] = useState<MyTimeOffRow[]>(initialUpcomingTimeOff);

  const loadState = useCallback(async () => {
    const [meRes, schedRes, toRes] = await Promise.all([
      fetch("/api/timeclock/me"),
      fetch("/api/timeclock/schedule"),
      fetch("/api/timeoff"),
    ]);
    if (meRes.ok) {
      const data = await meRes.json();
      setState(data.state);
    }
    if (schedRes.ok) setSchedule(await schedRes.json());
    if (toRes.ok) {
      const rows: MyTimeOffRow[] = await toRes.json();
      // Only requests whose window is still open — end_date >= today —
      // and only pending or approved. Denied noise stays off the
      // clock-in card; the user still sees it on /profile.
      const today = todayISO();
      const upcoming = rows
        .filter((r) => r.end_date >= today && (r.status === "pending" || r.status === "approved"))
        .sort((a, b) => a.start_date.localeCompare(b.start_date));
      setUpcomingTimeOff(upcoming);
    }
  }, []);

  useEffect(() => {
    // Skip the initial fetch when the server already hydrated us — the
    // paint is instant and the client re-fetches only after user actions
    // (punch, extend) or focus changes.
    if (initialState !== null && initialSchedule !== null) return;
    loadState().finally(() => setLoading(false));
  }, [loadState, initialState, initialSchedule]);

  const punch = async (event_type: "clock_in" | "clock_out" | "break_start" | "break_end") => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/timeclock/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_type }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(typeof body.error === "string" ? body.error : "Punch failed");
        return;
      }
      const data = await res.json();
      setState(data.state);
      // Refresh schedule too; a manual clock_out should silence the timer.
      loadState();
    } finally {
      setBusy(false);
    }
  };

  const isClockedOut = !state || state.status === "clocked_out";
  const isOnBreak = state?.status === "on_break";
  // Breaks / lunch count as clocked in per company policy — the app grid
  // stays live. Only a full clock-out (or no punches yet today) blurs the
  // launcher; that path is also covered by <ClockGate> at the layout
  // level, so this blur is a belt-and-braces for the /dashboard page.
  const isLocked = isClockedOut;

  const effEndLabel = schedule?.effective_end_iso ? fmtTime(schedule.effective_end_iso) : "";

  return (
    <div className="relative">
      {/* Top bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-sm text-muted-foreground">Status</div>
            <div className="font-semibold">
              {loading ? "…" : isClockedOut ? "Clocked out" : isOnBreak ? "On break" : "Clocked in"}
            </div>
          </div>
          {!isClockedOut && schedule?.effective_end_iso && (
            <div className="ml-4 text-xs text-muted-foreground">
              Scheduled until <span className="font-medium text-foreground">{effEndLabel}</span>
              {schedule.extension_until_iso && " (extended)"}
            </div>
          )}
        </div>
        {!loading && (
          isClockedOut ? (
            <Button onClick={() => punch("clock_in")} disabled={busy}>
              <LogIn className="mr-2 h-4 w-4" />Clock in
            </Button>
          ) : isOnBreak ? (
            <Button onClick={() => punch("break_end")} disabled={busy}>
              <Coffee className="mr-2 h-4 w-4" />End break
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => punch("break_start")} disabled={busy}>
                <Coffee className="mr-2 h-4 w-4" />Break
              </Button>
              <Button variant="outline" onClick={() => punch("clock_out")} disabled={busy}>
                <LogOut className="mr-2 h-4 w-4" />Clock out
              </Button>
            </div>
          )
        )}
      </div>

      {/* Children (app grid + links) — blurred + unclickable when clocked out or on break */}
      <div
        className={isLocked ? "pointer-events-none blur-md select-none" : ""}
        aria-hidden={isLocked}
      >
        {children}
      </div>

      {!loading && isLocked && (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-32">
          <div className="pointer-events-auto rounded-xl border bg-card shadow-lg p-8 text-center max-w-md">
            {isOnBreak ? (
              <>
                <Coffee className="mx-auto h-10 w-10 text-primary" />
                <h2 className="mt-3 text-xl font-bold">You&rsquo;re on break</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  End your break to unlock your applications.
                </p>
                <Button size="lg" className="mt-6 w-full" onClick={() => punch("break_end")} disabled={busy}>
                  <Coffee className="mr-2 h-5 w-5" />End break
                </Button>
              </>
            ) : (
              <>
                <Clock className="mx-auto h-10 w-10 text-primary" />
                <h2 className="mt-3 text-xl font-bold">You&rsquo;re clocked out</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Clock in to unlock your applications.
                </p>
                <Button size="lg" className="mt-6 w-full" onClick={() => punch("clock_in")} disabled={busy}>
                  <LogIn className="mr-2 h-5 w-5" />Clock in
                </Button>
              </>
            )}
            <UpcomingTimeOff rows={upcomingTimeOff} />
          </div>
        </div>
      )}

    </div>
  );
}

// Compact list of the viewer's own upcoming time off — pending +
// approved only. Nothing renders when there's nothing to show, so the
// clock-in card stays clean on quiet days.
function UpcomingTimeOff({ rows }: { rows: MyTimeOffRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-6 pt-4 border-t text-left space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <CalendarCheck className="h-3.5 w-3.5" />
        Upcoming time off
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-sm">
            <Badge
              variant={r.status === "approved" ? "default" : "outline"}
              className="text-[10px] capitalize"
            >
              {r.status}
            </Badge>
            <span className="font-medium">{fmtRange(r.start_date, r.end_date)}</span>
            <span className="text-xs text-muted-foreground truncate">
              {TIME_OFF_TYPE_LABEL[r.type]}
              {r.subcategory ? ` · ${r.subcategory}` : ""}
              {!r.full_day && r.hours ? ` · ${r.hours}h` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
