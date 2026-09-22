"use client";

import { signOut } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Clock, LogIn, LogOut } from "lucide-react";
import type { LiveState } from "@/lib/timesheets/state";

// Full-viewport clock-in gate. Sits at the top of the dashboard layout and
// throws a modal-style overlay in front of everything (sidebar, header,
// main content) whenever the viewer is clocked out. While the overlay is
// up, no click reaches the app underneath — enforced by fixed positioning
// + z-index 60 + full-screen backdrop.
//
// Break / lunch don't lock — those states count as clocked in per the
// company policy. The only escape hatches from the overlay are the
// clock-in button and Sign out. There's no bypass for admins or managers.
export function ClockGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/timeclock/me", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setState(data.state ?? null);
      }
    } catch {
      // Fail-open: if we can't reach the API, don't lock the user out of
      // the app (they still can't do anything on the server without auth).
      setState({
        status: "working",
        worked_ms: 0,
        lunch_ms: 0,
        break_ms: 0,
        session_start: null,
        last_event_at: null,
        current_span_started_at: null,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Re-check when the tab regains focus — if the midnight cron clocked
    // them out while the tab was in the background, the overlay should
    // reappear on the next focus.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const clockIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/timeclock/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: "clock_in" }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(typeof b.error === "string" ? b.error : "Clock in failed");
        return;
      }
      const data = await res.json();
      setState(data.state);
    } finally {
      setBusy(false);
    }
  };

  const locked = !loading && (state === null || state.status === "clocked_out");

  return (
    <>
      {children}
      {locked && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/90 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-lg">
            <Clock className="mx-auto h-10 w-10 text-primary" />
            <h2 className="mt-3 text-xl font-bold">You&rsquo;re clocked out</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Clock in to access the launcher. Everyone clocks in — including
              managers and admins.
            </p>
            {error && (
              <p className="mt-3 text-sm text-destructive">{error}</p>
            )}
            <Button
              size="lg"
              className="mt-6 w-full"
              onClick={clockIn}
              disabled={busy}
            >
              <LogIn className="mr-2 h-5 w-5" />
              {busy ? "Clocking in…" : "Clock in"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 w-full text-muted-foreground"
              onClick={() => signOut({ callbackUrl: "/login" })}
              disabled={busy}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
