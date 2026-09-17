"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CalendarCheck, Clock, Coffee, LogIn, LogOut } from "lucide-react";
import type { LiveState } from "@/lib/timesheets/state";
import {
  TIME_OFF_TYPE_LABEL,
  type TimeOffStatus,
  type TimeOffType,
} from "@/lib/timeoff/types";

interface Props {
  children: React.ReactNode;
}

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

const PROMPT_LEAD_MS = 5 * 60_000;
const EXTENSION_OPTIONS = [15, 30, 60];
const DISMISSED_KEY = "bbd-shift-prompt-dismissed";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// v2 clock system.
//   * Clock In / Clock Out — client posts /api/timeclock/punch.
//   * Launcher app grid is blurred + unclickable when clocked out.
//   * T-5 min before the effective end of the day, a modal asks "keep
//     working?". Yes → pick minutes → POST /api/timeclock/extend (which
//     pushes back the effective end). No or ignore → the server's
//     /api/cron/auto-clockout fires clock_out at the scheduled time.
export function TimeClockShell({ children }: Props) {
  const [state, setState] = useState<LiveState | null>(null);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [phase, setPhase] = useState<"ask" | "pick" | "custom">("ask");
  const [customMinutes, setCustomMinutes] = useState<string>("");
  const [upcomingTimeOff, setUpcomingTimeOff] = useState<MyTimeOffRow[]>([]);
  const promptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    loadState().finally(() => setLoading(false));
  }, [loadState]);

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
  const isLocked = isClockedOut || isOnBreak;

  // Set / reset the T-5 prompt timer whenever the effective end changes.
  useEffect(() => {
    if (promptTimer.current) clearTimeout(promptTimer.current);
    promptTimer.current = null;
    setPromptOpen(false);
    setPhase("ask");

    if (isClockedOut) return;
    const effEnd = schedule?.effective_end_iso;
    if (!effEnd) return;
    const dismissedFor = sessionStorage.getItem(DISMISSED_KEY);
    if (dismissedFor === effEnd) return;

    const showAt = new Date(effEnd).getTime() - PROMPT_LEAD_MS;
    const delay = showAt - Date.now();
    if (delay < 0) {
      // Past T-5 already — pop right away unless we're actually past the end
      // (cron will clock them out; no point prompting).
      if (Date.now() < new Date(effEnd).getTime()) setPromptOpen(true);
      return;
    }
    promptTimer.current = setTimeout(() => setPromptOpen(true), delay);
    return () => {
      if (promptTimer.current) clearTimeout(promptTimer.current);
    };
  }, [schedule?.effective_end_iso, isClockedOut]);

  const dismissPrompt = () => {
    if (schedule?.effective_end_iso) {
      sessionStorage.setItem(DISMISSED_KEY, schedule.effective_end_iso);
    }
    setPromptOpen(false);
    setPhase("ask");
  };

  const submitExtension = async (minutes: number) => {
    if (busy) return;
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 480) {
      alert("Enter a number of minutes between 1 and 480.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/timeclock/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(typeof body.error === "string" ? body.error : "Failed to extend");
        return;
      }
      const data = await res.json();
      // Sync schedule + drop the sessionStorage dismissal for the OLD end so
      // the timer re-arms against the new effective end.
      setSchedule((prev) =>
        prev
          ? { ...prev, extension_until_iso: data.effective_end_iso, effective_end_iso: data.effective_end_iso }
          : prev,
      );
      sessionStorage.removeItem(DISMISSED_KEY);
      setPromptOpen(false);
      setPhase("ask");
    } finally {
      setBusy(false);
    }
  };

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

      {/* End-of-shift prompt */}
      <Dialog
        open={promptOpen}
        onOpenChange={(o) => {
          if (!o) dismissPrompt();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              You&rsquo;re about to be clocked out at {effEndLabel}
            </DialogTitle>
          </DialogHeader>
          {phase === "ask" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Do you wish to keep working past that time? If you don&rsquo;t answer,
                you&rsquo;ll be clocked out automatically at {effEndLabel}.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={dismissPrompt} disabled={busy}>
                  No, clock me out
                </Button>
                <Button onClick={() => setPhase("pick")} disabled={busy}>
                  Yes, keep working
                </Button>
              </div>
            </div>
          )}
          {phase === "pick" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">How much longer?</p>
              <div className="grid grid-cols-2 gap-2">
                {EXTENSION_OPTIONS.map((m) => (
                  <Button
                    key={m}
                    variant="outline"
                    onClick={() => submitExtension(m)}
                    disabled={busy}
                  >
                    {m < 60 ? `${m} min` : `${m / 60} hour`}
                  </Button>
                ))}
                <Button variant="outline" onClick={() => setPhase("custom")} disabled={busy}>
                  Other…
                </Button>
              </div>
            </div>
          )}
          {phase === "custom" && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                submitExtension(Number.parseInt(customMinutes, 10));
              }}
            >
              <label className="block space-y-2">
                <span className="text-sm text-muted-foreground">Minutes (1–480)</span>
                <input
                  type="number"
                  min={1}
                  max={480}
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  required
                  autoFocus
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setPhase("pick")}>
                  Back
                </Button>
                <Button type="submit" disabled={busy}>
                  Extend
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
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
