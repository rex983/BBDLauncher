"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Clock, Coffee, LogOut } from "lucide-react";
import { useTimeClock } from "./ClockGate";

interface ScheduleData {
  scheduled: boolean;
  end_of_day_iso: string | null;
  extension_until_iso: string | null;
  effective_end_iso: string | null;
}

interface Props {
  children: React.ReactNode;
  // Server-fetched so the "Scheduled until" label paints on the first frame.
  initialSchedule?: ScheduleData | null;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Dashboard status bar: current clock status + break / clock-out buttons.
// Live state comes from <ClockGate> (layout level), which also owns the
// clocked-out lock — so there's no second overlay here.
// The T-5 min "keep working?" prompt lives in <ShiftEndPrompt>; ignoring
// it lets /api/cron/auto-clockout fire clock_out at the scheduled time.
export function TimeClockShell({ children, initialSchedule = null }: Props) {
  const { state, loading, punch } = useTimeClock();
  const [schedule, setSchedule] = useState<ScheduleData | null>(initialSchedule);
  const [busy, setBusy] = useState(false);

  const status = state?.status ?? "clocked_out";

  // A punch can change the effective end (e.g. clock_out silences it), so
  // refetch the schedule whenever the status changes. Skip the first run
  // when the server already hydrated it.
  const skipFirst = useRef(initialSchedule !== null);
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    let cancelled = false;
    fetch("/api/timeclock/schedule")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!cancelled && s) setSchedule(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status]);

  const doPunch = async (event_type: "clock_out" | "break_start" | "break_end") => {
    if (busy) return;
    setBusy(true);
    try {
      const err = await punch(event_type);
      if (err) alert(err);
    } finally {
      setBusy(false);
    }
  };

  const isClockedOut = status === "clocked_out";
  const isOnBreak = status === "on_break";
  const effEndLabel = schedule?.effective_end_iso ? fmtTime(schedule.effective_end_iso) : "";

  return (
    <div>
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
        {!loading && !isClockedOut && (
          isOnBreak ? (
            <Button onClick={() => doPunch("break_end")} disabled={busy}>
              <Coffee className="mr-2 h-4 w-4" />End break
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => doPunch("break_start")} disabled={busy}>
                <Coffee className="mr-2 h-4 w-4" />Break
              </Button>
              <Button variant="outline" onClick={() => doPunch("clock_out")} disabled={busy}>
                <LogOut className="mr-2 h-4 w-4" />Clock out
              </Button>
            </div>
          )
        )}
      </div>

      {children}
    </div>
  );
}
