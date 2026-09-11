"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Clock, LogIn, LogOut } from "lucide-react";
import type { LiveState } from "@/lib/timesheets/state";

interface Props {
  children: React.ReactNode;
}

// v1 clock system — deliberately minimal.
//   * Clock In / Clock Out only. No lunch/break/nag/timers.
//   * Launcher app grid is blurred + unclickable when clocked out.
//   * Applies to admins too (no bypass) — everyone clocks in.
// Lunch/break, end-of-day nag, and running totals are built but dormant;
// see git history for the full-featured version.
export function TimeClockShell({ children }: Props) {
  const [state, setState] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadState = useCallback(async () => {
    const res = await fetch("/api/timeclock/me");
    if (!res.ok) return;
    const data = await res.json();
    setState(data.state);
  }, []);

  useEffect(() => {
    loadState().finally(() => setLoading(false));
  }, [loadState]);

  const punch = async (event_type: "clock_in" | "clock_out") => {
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
    } finally {
      setBusy(false);
    }
  };

  const isClockedOut = !state || state.status === "clocked_out";

  return (
    <div className="relative">
      {/* Top bar — one status line + one button */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="text-sm text-muted-foreground">Status</div>
            <div className="font-semibold">
              {loading ? "…" : isClockedOut ? "Clocked out" : "Clocked in"}
            </div>
          </div>
        </div>
        {!loading && (
          isClockedOut ? (
            <Button onClick={() => punch("clock_in")} disabled={busy}>
              <LogIn className="mr-2 h-4 w-4" />Clock in
            </Button>
          ) : (
            <Button variant="outline" onClick={() => punch("clock_out")} disabled={busy}>
              <LogOut className="mr-2 h-4 w-4" />Clock out
            </Button>
          )
        )}
      </div>

      {/* Children (app grid + links) — blurred + unclickable when clocked out */}
      <div
        className={isClockedOut ? "pointer-events-none blur-md select-none" : ""}
        aria-hidden={isClockedOut}
      >
        {children}
      </div>

      {/* Big central Clock In card when clocked out */}
      {!loading && isClockedOut && (
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
    </div>
  );
}
