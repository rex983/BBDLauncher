// Derive a user's live status + today's totals from the flat punch event log.
// Sessions and totals are computed rather than stored; the event log is the
// only source of truth.

export type PunchEventType =
  | "clock_in"
  | "clock_out"
  | "lunch_start"
  | "lunch_end"
  | "break_start"
  | "break_end";

export interface TimePunch {
  id: string;
  profile_id: string;
  event_type: PunchEventType;
  occurred_at: string;
  source: "web" | "desktop" | "admin_edit";
  note: string | null;
}

export type LiveStatus =
  | "clocked_out"
  | "working"
  | "on_lunch"
  | "on_break";

export interface DayTotals {
  worked_ms: number;
  lunch_ms: number;
  break_ms: number;
  session_start: string | null;
  last_event_at: string | null;
}

export interface LiveState extends DayTotals {
  status: LiveStatus;
  current_span_started_at: string | null;
}

/** Fold punches (chronological) into current state + running totals. */
export function computeState(punches: TimePunch[], now: Date = new Date()): LiveState {
  const sorted = [...punches].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );

  let status: LiveStatus = "clocked_out";
  let worked_ms = 0;
  let lunch_ms = 0;
  let break_ms = 0;
  let session_start: string | null = null;
  let current_span_started_at: string | null = null;
  let last_event_at: string | null = null;

  // Track the timestamp when the current "working" span began (either clock_in
  // or lunch_end / break_end). Working time accumulates only during working spans.
  let working_span_start: Date | null = null;
  let lunch_span_start: Date | null = null;
  let break_span_start: Date | null = null;

  for (const p of sorted) {
    const t = new Date(p.occurred_at);
    last_event_at = p.occurred_at;

    switch (p.event_type) {
      case "clock_in":
        if (status === "clocked_out") {
          status = "working";
          session_start = p.occurred_at;
          working_span_start = t;
          current_span_started_at = p.occurred_at;
        }
        break;
      case "clock_out":
        if (status === "working" && working_span_start) {
          worked_ms += t.getTime() - working_span_start.getTime();
          working_span_start = null;
        } else if (status === "on_lunch" && lunch_span_start) {
          lunch_ms += t.getTime() - lunch_span_start.getTime();
          lunch_span_start = null;
        } else if (status === "on_break" && break_span_start) {
          break_ms += t.getTime() - break_span_start.getTime();
          break_span_start = null;
        }
        status = "clocked_out";
        current_span_started_at = null;
        break;
      case "lunch_start":
        if (status === "working" && working_span_start) {
          worked_ms += t.getTime() - working_span_start.getTime();
          working_span_start = null;
          status = "on_lunch";
          lunch_span_start = t;
          current_span_started_at = p.occurred_at;
        }
        break;
      case "lunch_end":
        if (status === "on_lunch" && lunch_span_start) {
          lunch_ms += t.getTime() - lunch_span_start.getTime();
          lunch_span_start = null;
          status = "working";
          working_span_start = t;
          current_span_started_at = p.occurred_at;
        }
        break;
      case "break_start":
        if (status === "working" && working_span_start) {
          worked_ms += t.getTime() - working_span_start.getTime();
          working_span_start = null;
          status = "on_break";
          break_span_start = t;
          current_span_started_at = p.occurred_at;
        }
        break;
      case "break_end":
        if (status === "on_break" && break_span_start) {
          break_ms += t.getTime() - break_span_start.getTime();
          break_span_start = null;
          status = "working";
          working_span_start = t;
          current_span_started_at = p.occurred_at;
        }
        break;
    }
  }

  // Add the currently-open span up to `now` so live totals tick forward.
  if (working_span_start) worked_ms += now.getTime() - working_span_start.getTime();
  if (lunch_span_start)   lunch_ms  += now.getTime() - lunch_span_start.getTime();
  if (break_span_start)   break_ms  += now.getTime() - break_span_start.getTime();

  return {
    status,
    worked_ms,
    lunch_ms,
    break_ms,
    session_start,
    last_event_at,
    current_span_started_at,
  };
}

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export const STATUS_LABEL: Record<LiveStatus, string> = {
  clocked_out: "Clocked out",
  working:     "Working",
  on_lunch:    "On lunch",
  on_break:    "On break",
};
