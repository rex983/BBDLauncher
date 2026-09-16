"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";
import { TIME_OFF_TYPE_LABEL, type TimeOffStatus, type TimeOffType } from "@/lib/timeoff/types";
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
}

const TYPE_COLOR: Record<TimeOffType, string> = {
  vacation: "bg-sky-500/80 text-white",
  sick: "bg-rose-500/80 text-white",
  personal: "bg-amber-500/80 text-white",
  parental: "bg-violet-500/80 text-white",
  other: "bg-slate-500/80 text-white",
};

const STATUS_RING: Record<TimeOffStatus, string> = {
  approved: "",
  pending: "ring-2 ring-inset ring-yellow-500/70",
  denied: "opacity-40 line-through",
  cancelled: "opacity-30",
};

function isoDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthStart(anchor: Date) {
  return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
}
function monthEnd(anchor: Date) {
  return new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
}

function eachDay(from: Date, to: Date): string[] {
  const out: string[] = [];
  const c = new Date(from);
  while (c <= to) {
    out.push(isoDate(c));
    c.setDate(c.getDate() + 1);
  }
  return out;
}

// Expand a request into all ISO dates it covers, inclusive.
function coveredDates(r: Request): string[] {
  const start = new Date(r.start_date + "T00:00:00");
  const end = new Date(r.end_date + "T00:00:00");
  if (end < start) return [r.start_date];
  return eachDay(start, end);
}

export function TimeOffCalendar() {
  const { viewAsOffice } = useRolePreview();
  const [anchor, setAnchor] = useState(() => new Date());
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPending, setShowPending] = useState(true);

  const from = isoDate(monthStart(anchor));
  const to = isoDate(monthEnd(anchor));

  useEffect(() => {
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
  }, [from, to, showPending, viewAsOffice]);

  // Map [profileId + isoDate] -> Request for O(1) cell lookup.
  const cellMap = useMemo(() => {
    const m = new Map<string, Request>();
    for (const r of requests) {
      for (const d of coveredDates(r)) {
        m.set(`${r.profile_id}|${d}`, r);
      }
    }
    return m;
  }, [requests]);

  // Only render employees who actually have time off this month — otherwise
  // the calendar is a wall of empty rows.
  const relevantProfiles = useMemo(() => {
    const ids = new Set(requests.map((r) => r.profile_id));
    return profiles
      .filter((p) => ids.has(p.id))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }, [profiles, requests]);

  const days = eachDay(monthStart(anchor), monthEnd(anchor));
  const todayISO = isoDate(new Date());
  const monthLabel = anchor.toLocaleDateString([], { month: "long", year: "numeric" });

  const shift = (delta: number) => {
    setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + delta, 1));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[180px] text-center font-medium">{monthLabel}</div>
          <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showPending}
            onChange={(e) => setShowPending(e.target.checked)}
          />
          Show pending
        </label>
      </div>

      <Legend />

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading calendar…</p>
      ) : relevantProfiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No time off in this month.</p>
      ) : (
        <div className="overflow-x-auto border rounded-md">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/60">
                <th className="sticky left-0 z-10 bg-muted/60 text-left p-2 border-r min-w-[160px]">
                  Employee
                </th>
                {days.map((d) => {
                  const dt = new Date(d + "T00:00:00");
                  const dow = dt.getDay();
                  const isWeekend = dow === 0 || dow === 6;
                  const isToday = d === todayISO;
                  return (
                    <th
                      key={d}
                      className={[
                        "p-1 border-r text-center font-normal min-w-[28px]",
                        isWeekend ? "bg-muted/40" : "",
                        isToday ? "outline outline-1 outline-primary" : "",
                      ].join(" ")}
                    >
                      <div className="text-[10px] text-muted-foreground">
                        {["S", "M", "T", "W", "T", "F", "S"][dow]}
                      </div>
                      <div>{dt.getDate()}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {relevantProfiles.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="sticky left-0 z-10 bg-background border-r p-2 whitespace-nowrap">
                    <Link
                      href={`/management/timesheets/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.name || p.email}
                    </Link>
                    <div className="text-[10px] text-muted-foreground">{p.office}</div>
                  </td>
                  {days.map((d) => {
                    const r = cellMap.get(`${p.id}|${d}`);
                    if (!r) {
                      const dow = new Date(d + "T00:00:00").getDay();
                      const isWeekend = dow === 0 || dow === 6;
                      return (
                        <td
                          key={d}
                          className={`border-r ${isWeekend ? "bg-muted/30" : ""}`}
                        />
                      );
                    }
                    const label = `${p.name || p.email} — ${TIME_OFF_TYPE_LABEL[r.type]}${r.subcategory ? ` (${r.subcategory})` : ""}${r.reason ? `\n${r.reason}` : ""} [${r.status}]`;
                    return (
                      <td key={d} className="border-r p-0">
                        <div
                          title={label}
                          className={[
                            "h-6 mx-0.5 my-0.5 rounded-sm text-[10px] flex items-center justify-center px-1",
                            TYPE_COLOR[r.type],
                            STATUS_RING[r.status],
                          ].join(" ")}
                        >
                          {r.full_day ? "" : `${r.hours}h`}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {items.map((i) => (
        <div key={i.type} className="flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded-sm ${TYPE_COLOR[i.type]}`} />
          <span>{i.label}</span>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-sm bg-slate-300 ring-2 ring-inset ring-yellow-500/70" />
        <span>Pending</span>
      </div>
      <Badge variant="outline" className="text-[10px]">Hover a cell for details</Badge>
    </div>
  );
}
