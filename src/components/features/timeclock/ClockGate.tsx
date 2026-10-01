"use client";

import { signOut } from "next-auth/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarCheck, Clock, LogIn, LogOut } from "lucide-react";
import type { LiveState, PunchEventType } from "@/lib/timesheets/state";
import {
  TIME_OFF_TYPE_LABEL,
  type TimeOffStatus,
  type TimeOffType,
} from "@/lib/timeoff/types";

// Single owner of the viewer's live clock state for every (dashboard) page.
// TimeClockShell and ShiftEndPrompt read it via useTimeClock() instead of
// keeping their own copies — separate copies drifted apart after a punch
// (the gate would unlock while the dashboard card still showed "clocked
// out", and a second clock-in then 409'd).
interface TimeClockContextValue {
  state: LiveState | null;
  loading: boolean;
  punch: (event_type: PunchEventType) => Promise<string | null>;
}

const TimeClockContext = createContext<TimeClockContextValue | null>(null);

export function useTimeClock(): TimeClockContextValue {
  const ctx = useContext(TimeClockContext);
  if (!ctx) throw new Error("useTimeClock must be used inside <ClockGate>");
  return ctx;
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

// Full-viewport clock-in gate. Sits at the top of the dashboard layout and
// throws a modal-style overlay in front of everything (sidebar, header,
// main content) whenever the viewer is clocked out. While the overlay is
// up, no click reaches the app underneath — enforced by fixed positioning
// + z-index 60 + full-screen backdrop.
//
// Break / lunch don't lock — those states count as clocked in per the
// company policy. The only escape hatches from the overlay are the
// clock-in button and Sign out. There's no bypass for admins or managers.
export function ClockGate({
  children,
  initialState = null,
}: {
  children: React.ReactNode;
  // Server-fetched in the layout so the gate paints correctly on the first
  // frame instead of flashing the app (or the overlay) while /me resolves.
  initialState?: LiveState | null;
}) {
  const [state, setState] = useState<LiveState | null>(initialState);
  const [loading, setLoading] = useState(initialState === null);
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
    if (initialState === null) load();
    // Re-check when the tab regains focus — if the midnight cron clocked
    // them out while the tab was in the background, the overlay should
    // reappear on the next focus.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load, initialState]);

  // Returns an error message, or null on success. A 409 means our state
  // was stale (e.g. punched from another tab) — resync so the UI matches
  // the server instead of leaving the user stuck on the wrong button.
  const punch = useCallback(
    async (event_type: PunchEventType): Promise<string | null> => {
      const res = await fetch("/api/timeclock/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_type }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          await load();
          return null;
        }
        const b = await res.json().catch(() => ({}));
        return typeof b.error === "string" ? b.error : "Punch failed";
      }
      const data = await res.json();
      setState(data.state);
      return null;
    },
    [load],
  );

  const clockIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setError(await punch("clock_in"));
    } catch {
      setError("Clock in failed");
    } finally {
      setBusy(false);
    }
  };

  const locked = !loading && (state === null || state.status === "clocked_out");

  return (
    <TimeClockContext.Provider value={{ state, loading, punch }}>
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
            <UpcomingTimeOff />
          </div>
        </div>
      )}
    </TimeClockContext.Provider>
  );
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

// Compact list of the viewer's own upcoming time off — pending + approved
// only, end_date >= today. Fetched only while the gate is showing; renders
// nothing on quiet days so the clock-in card stays clean.
function UpcomingTimeOff() {
  const [rows, setRows] = useState<MyTimeOffRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/timeoff")
      .then((r) => (r.ok ? r.json() : []))
      .then((all: MyTimeOffRow[]) => {
        if (cancelled) return;
        const today = todayISO();
        setRows(
          all
            .filter((r) => r.end_date >= today && (r.status === "pending" || r.status === "approved"))
            .sort((a, b) => a.start_date.localeCompare(b.start_date)),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
