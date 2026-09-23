"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";
import { canEditTimeData } from "@/lib/auth/permissions";
import {
  RequestDetailDialog,
  type DetailRow,
} from "@/components/features/timeoff/RequestDetailDialog";
import {
  TIME_OFF_TYPE_LABEL,
  todayISO,
  type TimeOffAttachment,
  type TimeOffStatus,
  type TimeOffType,
} from "@/lib/timeoff/types";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Profile {
  id: string;
  email: string;
  name: string | null;
  office: string | null;
  department: string | null;
}

interface Request {
  id: string;
  profile_id: string;
  type: TimeOffType;
  subcategory: string | null;
  start_date: string;
  end_date: string;
  full_day: boolean;
  hours: number | null;
  status: TimeOffStatus;
  reason: string | null;
  decided_note: string | null;
  decided_at: string | null;
  created_at: string;
  attachments: TimeOffAttachment[] | null;
}

// Tailwind background + text pairs, keyed by type. Kept as a full class name
// so JIT can pick them up — don't build these strings dynamically.
const TYPE_COLOR: Record<TimeOffType, string> = {
  vacation: "bg-sky-500/85 text-white",
  sick: "bg-rose-500/85 text-white",
  personal: "bg-amber-500/85 text-white",
  parental: "bg-violet-500/85 text-white",
  other: "bg-slate-500/85 text-white",
};

const STATUS_MOD: Record<TimeOffStatus, string> = {
  approved: "",
  pending: "ring-2 ring-inset ring-yellow-500/80",
  denied: "opacity-40 line-through",
  cancelled: "opacity-25",
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EVENT_ROW_HEIGHT = 22; // px — matches the pill's h-5 + margin
const EVENT_TOP_OFFSET = 26; // px — leaves room for the date number
const MAX_VISIBLE_ROWS = 4;

function isoDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(d: Date, n: number) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function startOfWeek(d: Date) {
  const c = new Date(d);
  c.setDate(c.getDate() - c.getDay()); // Sunday
  c.setHours(0, 0, 0, 0);
  return c;
}

// Build the 6x7 grid that renders one month. Includes leading/trailing days
// from the sibling months so every row has 7 columns (Google-Calendar style).
function buildMonthGrid(anchor: Date) {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(firstOfMonth);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) row.push(addDays(gridStart, w * 7 + d));
    weeks.push(row);
  }
  return { weeks, gridStart, gridEnd: addDays(gridStart, 41) };
}

// Overlap check: [aStart, aEnd] intersects [bStart, bEnd].
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart <= bEnd && aEnd >= bStart;
}

interface WeekEvent {
  request: Request;
  profile: Profile | undefined;
  colStart: number; // 0-6 within the week
  colEnd: number;   // 0-6 inclusive
  row: number;      // vertical stacking index
  clippedLeft: boolean;  // event started before this week
  clippedRight: boolean; // event ends after this week
}

// Greedy row assignment: earliest colStart first, drop into the lowest row
// that has no collision. Google Calendar does the same thing.
function assignRows(events: Omit<WeekEvent, "row">[]): WeekEvent[] {
  const sorted = [...events].sort((a, b) => a.colStart - b.colStart);
  const rowEnds: number[] = [];
  const out: WeekEvent[] = [];
  for (const e of sorted) {
    let r = 0;
    while (r < rowEnds.length && rowEnds[r] >= e.colStart) r++;
    rowEnds[r] = e.colEnd;
    out.push({ ...e, row: r });
  }
  return out;
}

export function TimeOffCalendar({
  refreshKey = 0,
  active = true,
}: { refreshKey?: number; active?: boolean } = {}) {
  const { viewAsOffice } = useRolePreview();
  const { data: session } = useSession();
  const canManage = canEditTimeData(session?.user?.role);
  const [anchor, setAnchor] = useState(() => new Date());
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPending, setShowPending] = useState(true);
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  const [selected, setSelected] = useState<DetailRow | null>(null);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);

  const { weeks, gridStart, gridEnd } = useMemo(() => buildMonthGrid(anchor), [anchor]);
  const from = isoDate(gridStart);
  const to = isoDate(gridEnd);

  useEffect(() => {
    // Skip fetching entirely when the tab isn't active — the parent
    // page mounts multiple tabs at once and we don't want to burn
    // Supabase round-trips on views the user isn't looking at.
    if (!active) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const params = new URLSearchParams({ from, to });
      params.set("statuses", showPending ? "approved,pending" : "approved");
      if (viewAsOffice) params.set("office", viewAsOffice);
      const res = await fetch(`/api/management/timeoff/range?${params.toString()}`);
      if (cancelled) return;
      if (res.ok) {
        const body = await res.json();
        setProfiles(body.profiles || []);
        setRequests(body.requests || []);
      } else {
        setProfiles([]);
        setRequests([]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [active, from, to, showPending, viewAsOffice, refreshKey, localRefreshKey]);

  const profileById = useMemo(() => {
    const m = new Map<string, Profile>();
    for (const p of profiles) m.set(p.id, p);
    return m;
  }, [profiles]);

  // Compute stacked events per week — a request spanning multiple weeks
  // shows up in each week clipped to that week's bounds.
  const weekEvents = useMemo(() => {
    return weeks.map((week) => {
      const weekStartISO = isoDate(week[0]);
      const weekEndISO = isoDate(week[6]);
      const raw: Omit<WeekEvent, "row">[] = [];
      for (const r of requests) {
        if (!overlaps(r.start_date, r.end_date, weekStartISO, weekEndISO)) continue;
        // Clip to week; compute column indices from clipped dates.
        const clippedLeft = r.start_date < weekStartISO;
        const clippedRight = r.end_date > weekEndISO;
        const startClipped = clippedLeft ? weekStartISO : r.start_date;
        const endClipped = clippedRight ? weekEndISO : r.end_date;
        const colStart = week.findIndex((d) => isoDate(d) === startClipped);
        const colEnd = week.findIndex((d) => isoDate(d) === endClipped);
        if (colStart < 0 || colEnd < 0) continue;
        raw.push({
          request: r,
          profile: profileById.get(r.profile_id),
          colStart,
          colEnd,
          clippedLeft,
          clippedRight,
        });
      }
      return assignRows(raw);
    });
  }, [weeks, requests, profileById]);

  const currentMonth = anchor.getMonth();
  const monthLabel = anchor.toLocaleDateString([], { month: "long", year: "numeric" });
  const todayISOStr = todayISO();

  const shift = (delta: number) => {
    setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + delta, 1));
    setExpandedWeek(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[180px] text-center text-lg font-semibold">{monthLabel}</div>
          <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setAnchor(new Date()); setExpandedWeek(null); }}>
            Today
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Legend />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showPending}
              onChange={(e) => setShowPending(e.target.checked)}
            />
            Show pending
          </label>
        </div>
      </div>

      <div className="border rounded-md overflow-hidden bg-card">
        <div className="grid grid-cols-7 border-b bg-muted/60 text-xs font-medium">
          {WEEKDAY_LABELS.map((l) => (
            <div key={l} className="px-2 py-1 text-center border-r last:border-r-0">
              {l}
            </div>
          ))}
        </div>

        {loading && (
          <div className="p-6 text-sm text-muted-foreground text-center">Loading calendar…</div>
        )}

        {!loading && weeks.map((week, wi) => {
          const events = weekEvents[wi];
          const isExpanded = expandedWeek === wi;
          const rowCount = events.reduce((max, e) => Math.max(max, e.row + 1), 0);
          const visibleRows = isExpanded ? rowCount : Math.min(rowCount, MAX_VISIBLE_ROWS);
          const cellMinHeight = EVENT_TOP_OFFSET + Math.max(visibleRows, 1) * EVENT_ROW_HEIGHT + 8;
          const overflowCount = rowCount - MAX_VISIBLE_ROWS;

          return (
            <div
              key={wi}
              className="relative grid grid-cols-7 border-b last:border-b-0"
              style={{ minHeight: `${cellMinHeight}px` }}
            >
              {week.map((day, di) => {
                const isOther = day.getMonth() !== currentMonth;
                const dayISO = isoDate(day);
                const isToday = dayISO === todayISOStr;
                const isWeekend = di === 0 || di === 6;
                return (
                  <div
                    key={di}
                    className={[
                      "border-r last:border-r-0 p-1 text-xs",
                      isOther ? "bg-muted/20 text-muted-foreground/60" : "",
                      isWeekend && !isOther ? "bg-muted/10" : "",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "inline-flex items-center justify-center h-6 w-6 rounded-full text-xs",
                        isToday ? "bg-primary text-primary-foreground font-semibold" : "",
                      ].join(" ")}
                    >
                      {day.getDate()}
                    </div>
                  </div>
                );
              })}

              {events
                .filter((e) => isExpanded || e.row < MAX_VISIBLE_ROWS)
                .map((e, ei) => (
                  <EventBar
                    key={`${wi}-${ei}`}
                    event={e}
                    onClick={() => setSelected(toDetailRow(e.request, e.profile))}
                  />
                ))}

              {!isExpanded && overflowCount > 0 && (
                <button
                  type="button"
                  onClick={() => setExpandedWeek(wi)}
                  className="absolute right-1 text-[10px] text-muted-foreground hover:text-foreground underline"
                  style={{
                    bottom: 2,
                  }}
                >
                  +{overflowCount} more
                </button>
              )}
              {isExpanded && (
                <button
                  type="button"
                  onClick={() => setExpandedWeek(null)}
                  className="absolute right-1 text-[10px] text-muted-foreground hover:text-foreground underline"
                  style={{ bottom: 2 }}
                >
                  Show less
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Hover a bar for a quick peek. Click a bar to open, edit, or delete the request.
      </p>

      <RequestDetailDialog
        row={selected}
        onClose={() => setSelected(null)}
        canDecide={canManage}
        canEdit={canManage}
        onChanged={() => setLocalRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

function toDetailRow(r: Request, p: Profile | undefined): DetailRow {
  return {
    id: r.id,
    profile_id: r.profile_id,
    profile: p
      ? { name: p.name, email: p.email, office: p.office }
      : null,
    type: r.type,
    subcategory: r.subcategory,
    start_date: r.start_date,
    end_date: r.end_date,
    full_day: r.full_day,
    hours: r.hours,
    reason: r.reason,
    status: r.status,
    decided_note: r.decided_note,
    decided_at: r.decided_at,
    created_at: r.created_at,
    attachments: r.attachments,
  };
}

function EventBar({ event, onClick }: { event: WeekEvent; onClick: () => void }) {
  const r = event.request;
  const p = event.profile;
  const label = `${p?.name || p?.email || "Unknown"} — ${TIME_OFF_TYPE_LABEL[r.type]}${
    r.subcategory ? ` (${r.subcategory})` : ""
  }\n${r.start_date}${r.start_date !== r.end_date ? ` – ${r.end_date}` : ""}${
    r.reason ? `\n${r.reason}` : ""
  }\n[${r.status}]`;

  // Percent-based positioning so the bar spans its actual grid columns.
  const leftPct = (event.colStart / 7) * 100;
  const widthPct = ((event.colEnd - event.colStart + 1) / 7) * 100;

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "absolute h-5 rounded-sm px-1.5 text-[10px] leading-5 truncate text-left cursor-pointer",
        "hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-primary/60",
        TYPE_COLOR[r.type],
        STATUS_MOD[r.status],
        event.clippedLeft ? "rounded-l-none border-l-2 border-l-white/40" : "",
        event.clippedRight ? "rounded-r-none border-r-2 border-r-white/40" : "",
      ].join(" ")}
      style={{
        left: `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
        top: `${EVENT_TOP_OFFSET + event.row * EVENT_ROW_HEIGHT}px`,
      }}
      title={label}
    >
      {r.full_day
        ? (p?.name || p?.email || "—")
        : `${p?.name || p?.email || "—"} · ${r.hours}h`}
    </button>
  );
}

function Legend() {
  const items: { type: TimeOffType; label: string }[] = [
    { type: "vacation", label: "Vacation" },
    { type: "sick", label: "Sick" },
    { type: "personal", label: "Personal" },
    { type: "parental", label: "Parental" },
    { type: "other", label: "Other" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {items.map((i) => (
        <div key={i.type} className="flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded-sm ${TYPE_COLOR[i.type]}`} />
          <span className="text-muted-foreground">{i.label}</span>
        </div>
      ))}
      <Badge variant="outline" className="text-[10px]">Hover for details</Badge>
    </div>
  );
}
