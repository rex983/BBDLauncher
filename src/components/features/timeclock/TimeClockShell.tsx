"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Clock, LogIn, LogOut, Coffee, Utensils, Play,
} from "lucide-react";
import {
  computeState, formatDuration, STATUS_LABEL,
  type LiveState, type PunchEventType, type TimePunch,
} from "@/lib/timesheets/state";

interface Props {
  children: React.ReactNode;
  isAdmin?: boolean;
}

interface ScheduleInfo {
  scheduled: boolean;
  end_of_day_iso: string | null;
  start_time: string;
  end_time: string;
}

const AUTO_LOGOUT_MS = 30 * 60 * 1000; // 30 min no response after prompt = auto clock out
const NAG_INTERVAL_MS = 30 * 60 * 1000; // repeat every 30 min after scheduled end

export function TimeClockShell({ children, isAdmin = false }: Props) {
  const [state, setState] = useState<LiveState | null>(null);
  const [punches, setPunches] = useState<TimePunch[]>([]);
  const [schedule, setSchedule] = useState<ScheduleInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nagOpen, setNagOpen] = useState(false);
  const [nagOpenedAt, setNagOpenedAt] = useState<number | null>(null);
  const nagTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoLogoutTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [now, setNow] = useState(Date.now());

  // ------- data loaders -------
  const loadState = useCallback(async () => {
    const res = await fetch("/api/timeclock/me");
    if (!res.ok) return;
    const data = await res.json();
    setState(data.state);
    setPunches(data.punches);
  }, []);

  const loadSchedule = useCallback(async () => {
    const res = await fetch("/api/timeclock/schedule");
    if (!res.ok) return;
    setSchedule(await res.json());
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([loadState(), loadSchedule()]);
      setLoading(false);
    })();
  }, [loadState, loadSchedule]);

  // Local wall-clock tick so open spans keep counting without refetches.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Local re-derivation so live totals tick forward without refetching.
  const liveState: LiveState | null = state
    ? computeState(punches, new Date(now))
    : null;

  // ------- punch action -------
  const punch = async (event_type: PunchEventType) => {
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
      setPunches(data.punches);
    } finally {
      setBusy(false);
    }
  };

  // ------- end-of-day nag scheduler -------
  // When we're working and past scheduled end time, open the nag. If it stays
  // open for AUTO_LOGOUT_MS, auto clock-out. If dismissed with "Keep working",
  // schedule the next nag in NAG_INTERVAL_MS.
  useEffect(() => {
    if (!liveState || !schedule?.end_of_day_iso) return;
    if (liveState.status === "clocked_out") return;

    const endTs = new Date(schedule.end_of_day_iso).getTime();
    const nowTs = Date.now();

    if (!nagOpen) {
      // Not open yet — schedule the initial trigger for endTs (or now if past).
      const delay = Math.max(0, endTs - nowTs);
      if (nagTimeoutRef.current) clearTimeout(nagTimeoutRef.current);
      nagTimeoutRef.current = setTimeout(() => {
        setNagOpen(true);
        setNagOpenedAt(Date.now());
      }, delay);
    }

    return () => {
      if (nagTimeoutRef.current) {
        clearTimeout(nagTimeoutRef.current);
        nagTimeoutRef.current = null;
      }
    };
  }, [liveState?.status, schedule?.end_of_day_iso, nagOpen]);

  // Auto-logout timer while the nag is open.
  useEffect(() => {
    if (!nagOpen || !nagOpenedAt) return;
    if (autoLogoutTimeoutRef.current) clearTimeout(autoLogoutTimeoutRef.current);
    autoLogoutTimeoutRef.current = setTimeout(async () => {
      // No response → auto clock out.
      await punch("clock_out");
      setNagOpen(false);
      setNagOpenedAt(null);
    }, AUTO_LOGOUT_MS);

    return () => {
      if (autoLogoutTimeoutRef.current) {
        clearTimeout(autoLogoutTimeoutRef.current);
        autoLogoutTimeoutRef.current = null;
      }
    };
  }, [nagOpen, nagOpenedAt]);

  const handleKeepWorking = () => {
    setNagOpen(false);
    setNagOpenedAt(null);
    // Reset scheduled end forward by NAG_INTERVAL_MS so the next nag opens later.
    if (nagTimeoutRef.current) clearTimeout(nagTimeoutRef.current);
    nagTimeoutRef.current = setTimeout(() => {
      setNagOpen(true);
      setNagOpenedAt(Date.now());
    }, NAG_INTERVAL_MS);
  };

  const handleClockOutFromNag = async () => {
    await punch("clock_out");
    setNagOpen(false);
    setNagOpenedAt(null);
  };

  // ------- render -------
  const isClockedOut = !liveState || liveState.status === "clocked_out";
  const isWorking = liveState?.status === "working";
  const isOnLunch = liveState?.status === "on_lunch";
  const isOnBreak = liveState?.status === "on_break";

  // Elapsed on current span (for the lunch/break timer chip).
  const currentSpanElapsed = liveState?.current_span_started_at
    ? Date.now() - new Date(liveState.current_span_started_at).getTime()
    : 0;

  return (
    <div className="relative">
      {/* Top status bar — always visible */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-sm text-muted-foreground">Status</div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">
                {loading ? "…" : STATUS_LABEL[liveState?.status ?? "clocked_out"]}
              </span>
              {(isOnLunch || isOnBreak) && (
                <Badge variant="outline" className="tabular-nums">
                  {formatDuration(currentSpanElapsed)}
                </Badge>
              )}
            </div>
          </div>
          {liveState && liveState.status !== "clocked_out" && (
            <>
              <Sep />
              <Stat label="Worked today" value={formatDuration(liveState.worked_ms)} />
              <Sep />
              <Stat label="Lunch" value={formatDuration(liveState.lunch_ms)} />
              <Sep />
              <Stat label="Breaks" value={formatDuration(liveState.break_ms)} />
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isClockedOut && (
            <Button onClick={() => punch("clock_in")} disabled={busy || loading}>
              <LogIn className="mr-2 h-4 w-4" />Clock in
            </Button>
          )}
          {isWorking && (
            <>
              <Button variant="outline" onClick={() => punch("lunch_start")} disabled={busy}>
                <Utensils className="mr-2 h-4 w-4" />Start lunch
              </Button>
              <Button variant="outline" onClick={() => punch("break_start")} disabled={busy}>
                <Coffee className="mr-2 h-4 w-4" />Start break
              </Button>
              <Button variant="destructive" onClick={() => punch("clock_out")} disabled={busy}>
                <LogOut className="mr-2 h-4 w-4" />Clock out
              </Button>
            </>
          )}
          {isOnLunch && (
            <Button onClick={() => punch("lunch_end")} disabled={busy}>
              <Play className="mr-2 h-4 w-4" />End lunch
            </Button>
          )}
          {isOnBreak && (
            <Button onClick={() => punch("break_end")} disabled={busy}>
              <Play className="mr-2 h-4 w-4" />End break
            </Button>
          )}
        </div>
      </div>

      {/* Children (app grid + rest of dashboard) — blurred + unclickable when
          clocked out. Admins are exempt so they can always click through. */}
      <div
        className={isClockedOut && !isAdmin ? "pointer-events-none blur-md select-none" : ""}
        aria-hidden={isClockedOut && !isAdmin}
      >
        {children}
      </div>

      {/* Big central Clock In card when clocked out (skipped for admins). */}
      {!loading && isClockedOut && !isAdmin && (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-32">
          <div className="pointer-events-auto rounded-xl border bg-card shadow-lg p-8 text-center max-w-md">
            <Clock className="mx-auto h-10 w-10 text-primary" />
            <h2 className="mt-3 text-xl font-bold">You&rsquo;re clocked out</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Clock in to unlock your applications.
            </p>
            <Button size="lg" className="mt-6 w-full" onClick={() => punch("clock_in")} disabled={busy}>
              <LogIn className="mr-2 h-5 w-5" />Clock in
            </Button>
          </div>
        </div>
      )}

      {/* End-of-day nag modal */}
      <Dialog open={nagOpen} onOpenChange={(open) => { if (!open) handleKeepWorking(); }}>
        <DialogContent onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Still working?</DialogTitle>
            <DialogDescription>
              Your scheduled end time has passed. Want to keep working or clock out?
              <br />
              <span className="text-xs text-muted-foreground">
                If you don&rsquo;t respond within 30 minutes, you&rsquo;ll be clocked out automatically.
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={handleClockOutFromNag}>
              <LogOut className="mr-2 h-4 w-4" />Clock out
            </Button>
            <Button onClick={handleKeepWorking}>
              <Play className="mr-2 h-4 w-4" />Keep working
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Sep() {
  return <div className="h-8 w-px bg-border" />;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}
