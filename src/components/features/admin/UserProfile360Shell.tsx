"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  computeState,
  formatDuration,
  STATUS_LABEL,
  type PunchEventType,
  type TimePunch,
} from "@/lib/timesheets/state";
import { computeDayWorkedMs } from "@/lib/timesheets/weekly";
import { localDateInZone, startOfDayInZone } from "@/lib/timesheets/tz";
import {
  requestDays,
  TIME_OFF_TYPE_LABEL,
  TIME_OFF_TYPES,
  type TimeOffType,
} from "@/lib/timeoff/types";
import {
  formatIncidentNumber,
  INCIDENT_CATEGORY_LABEL,
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_STATUS_LABEL,
  type IncidentSeverity,
  type IncidentStatus,
} from "@/lib/incidents/types";
import type { IncidentSummary } from "@/components/features/incidents/IncidentPanel";
import type {
  EmployeeDetailData,
  WindowTimeOffRow,
  YtdBreakdown,
} from "@/lib/timesheets/detail";

// ---------- shared types & helpers ----------

interface Profile {
  id: string;
  email: string;
  name: string | null;
  role: string;
  office: string | null;
  department: string | null;
  is_it: boolean | null;
  is_active: boolean | null;
  created_at: string;
}

interface WorkScheduleRow {
  weekday: number;
  start_time: string;
  end_time: string;
  timezone: string;
}

// Payload matches /api/analytics/users/[id] — kept loose so we don't have to
// rebuild it if the analytics API adds fields.
interface AnalyticsPayload {
  totals: {
    events: number;
    unique_destinations: number;
    app_launches: number;
    link_clicks: number;
    first_event: string | null;
    last_event: string | null;
  };
  destinations: {
    id: string;
    name: string;
    kind: "app" | "link";
    count: number;
    first_used: string;
    last_used: string;
  }[];
  audit_log: {
    id: string;
    created_at: string;
    destination_id: string | null;
    destination_name: string;
    kind: "app" | "link";
    ip_address: string | null;
    user_agent: string | null;
  }[];
  audit_log_truncated: boolean;
}

const RANGES = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_WORKDAYS = new Set([1, 2, 3, 4, 5]);
const DEFAULT_START = "10:00";
const DEFAULT_END = "18:00";

const SEVERITY_VARIANT: Record<
  IncidentSeverity,
  "default" | "secondary" | "outline" | "destructive"
> = {
  low: "secondary",
  medium: "outline",
  high: "default",
  critical: "destructive",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDate(iso);
}

function fmtTime(t: string) {
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}

function fmtDays(d: number): string {
  return d === 0 ? "0" : (Math.round(d * 10) / 10).toString();
}

function shortenAgent(ua: string | null) {
  if (!ua) return "—";
  const m = ua.match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/);
  if (m) return m[0];
  return ua.slice(0, 60) + (ua.length > 60 ? "…" : "");
}

// Map the analytics range picker to a punches window. The timesheet loader
// tops out at 30 days for direct fetch, so 90d/all fall back to 30d for the
// punches section — analytics side handles the wider windows independently.
function rangeToDays(range: string): number {
  switch (range) {
    case "24h":
      return 1;
    case "7d":
      return 7;
    case "30d":
    case "90d":
    case "all":
      return 30;
    default:
      return 30;
  }
}

// Bucketed totals across the punches window. Same math as the /profile page.
function aggregatePunches(punches: TimePunch[]): {
  worked_ms: number;
  lunch_ms: number;
  break_ms: number;
  days: number;
} {
  if (punches.length === 0) return { worked_ms: 0, lunch_ms: 0, break_ms: 0, days: 0 };
  const now = new Date();
  const startOfToday = startOfDayInZone(now);
  const todayKey = localDateInZone(now);

  const dayBuckets = new Map<string, TimePunch[]>();
  for (const p of punches) {
    const key = localDateInZone(new Date(p.occurred_at));
    const list = dayBuckets.get(key) || [];
    list.push(p);
    dayBuckets.set(key, list);
  }

  let worked_ms = 0;
  let lunch_ms = 0;
  let break_ms = 0;
  for (const [dayKey, list] of dayBuckets) {
    worked_ms += computeDayWorkedMs(list, dayKey, now);
    const capNow = dayKey === todayKey ? now : new Date(startOfToday);
    if (dayKey !== todayKey) {
      const [y, m, d] = dayKey.split("-").map(Number);
      const dayEnd = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
      capNow.setTime(dayEnd.getTime());
    }
    const s = computeState(list, capNow);
    lunch_ms += s.lunch_ms;
    break_ms += s.break_ms;
  }
  return { worked_ms, lunch_ms, break_ms, days: dayBuckets.size };
}

const EVENT_LABEL: Record<PunchEventType, string> = {
  clock_in: "Clock in",
  clock_out: "Clock out",
  lunch_start: "Lunch start",
  lunch_end: "Lunch end",
  break_start: "Break start",
  break_end: "Break end",
};

// ---------- component ----------

export function UserProfile360Shell({
  userId,
  initialRange,
  profile,
  initialDays,
  timeData,
  timeDataError,
  workSchedule,
  incidents: initialIncidents,
}: {
  userId: string;
  initialRange: string;
  profile: Profile | null;
  initialDays: number;
  timeData: EmployeeDetailData | null;
  timeDataError: string | null;
  workSchedule: WorkScheduleRow[];
  incidents: IncidentSummary[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [range, setRange] = useState(initialRange);
  const [tab, setTab] = useState("overview");
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  const [days, setDays] = useState(initialDays);
  const [punches, setPunches] = useState<TimePunch[]>(timeData?.punches ?? []);
  const [timeOffWindow, setTimeOffWindow] = useState<WindowTimeOffRow[]>(
    timeData?.time_off.window ?? [],
  );
  const [timeOffYtd, setTimeOffYtd] = useState<YtdBreakdown>(
    timeData?.time_off.ytd ?? emptyYtd(),
  );
  const [timeLoading, setTimeLoading] = useState(false);
  const [incidents, setIncidents] = useState<IncidentSummary[]>(initialIncidents);

  // ---- fetch analytics whenever range changes ----
  useEffect(() => {
    let cancelled = false;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    fetch(`/api/analytics/users/${userId}?range=${range}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Failed to load");
        return r.json();
      })
      .then((json: AnalyticsPayload) => {
        if (!cancelled) setAnalytics(json);
      })
      .catch((e: Error) => {
        if (!cancelled) setAnalyticsError(e.message);
      })
      .finally(() => {
        if (!cancelled) setAnalyticsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, userId]);

  // ---- refetch time data when punches window changes ----
  const loadTime = useCallback(async () => {
    if (timeDataError) return;
    setTimeLoading(true);
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);
    const url = `/api/management/timesheets/employee/${userId}?from=${from.toISOString()}&to=${now.toISOString()}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      setPunches(data.punches);
      if (data.time_off) {
        setTimeOffWindow(data.time_off.window ?? []);
        setTimeOffYtd(data.time_off.ytd ?? emptyYtd());
      }
    }
    setTimeLoading(false);
  }, [userId, days, timeDataError]);

  // Only refetch when days actually changes from initial (avoids double-load).
  useEffect(() => {
    if (days === initialDays) return;
    loadTime();
  }, [days, initialDays, loadTime]);

  // Sync days to analytics range when range picker changes.
  useEffect(() => {
    const next = rangeToDays(range);
    if (next !== days) setDays(next);
  }, [range, days]);

  // Incidents are hydrated server-side — this page doesn't poll. Filed or
  // signed incidents will show on a hard refresh; the /management/incidents
  // page is the live queue.
  void setIncidents;

  // Persist range in the URL so bookmarks/back-buttons stay coherent.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("range") !== range) {
      params.set("range", range);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [range, router, searchParams]);

  const displayName =
    profile?.name ?? profile?.email ?? "Unknown user";

  const liveState = useMemo(() => computeState(punches), [punches]);
  const aggregate = useMemo(() => aggregatePunches(punches), [punches]);

  // Weekly schedule with default fallback (same rule as /profile).
  const hasAnyOverride = workSchedule.length > 0;
  const scheduleByWeekday = new Map(workSchedule.map((s) => [s.weekday, s]));
  const weekView = [0, 1, 2, 3, 4, 5, 6].map((wd) => {
    const override = scheduleByWeekday.get(wd);
    if (override) {
      return {
        weekday: wd,
        scheduled: true,
        start: override.start_time.slice(0, 5),
        end: override.end_time.slice(0, 5),
        tz: override.timezone,
      };
    }
    if (hasAnyOverride) {
      return { weekday: wd, scheduled: false, start: "", end: "", tz: "America/New_York" };
    }
    return {
      weekday: wd,
      scheduled: DEFAULT_WORKDAYS.has(wd),
      start: DEFAULT_START,
      end: DEFAULT_END,
      tz: "America/New_York",
    };
  });

  const pendingIncidents = incidents.filter(
    (i) => i.status === "awaiting_manager_sig" || i.status === "awaiting_employee_sig",
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href={`/admin/analytics?range=${range}`}>
            <ArrowLeft className="h-4 w-4" />
            Back to analytics
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{displayName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {profile?.email && <span>{profile.email}</span>}
              {profile?.role && (
                <>
                  <span>·</span>
                  <Badge variant="secondary">{profile.role}</Badge>
                </>
              )}
              {profile?.office && (
                <>
                  <span>·</span>
                  <Badge variant="outline">{profile.office}</Badge>
                </>
              )}
              {profile?.department && (
                <>
                  <span>·</span>
                  <Badge variant="outline">{profile.department}</Badge>
                </>
              )}
              {profile?.is_it && (
                <>
                  <span>·</span>
                  <Badge>IT</Badge>
                </>
              )}
              {profile?.is_active === false && (
                <>
                  <span>·</span>
                  <Badge variant="destructive">Inactive</Badge>
                </>
              )}
            </div>
            {profile?.created_at && (
              <p className="text-xs text-muted-foreground mt-2">
                Joined {fmtDate(profile.created_at)}
              </p>
            )}
          </div>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {analyticsError && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {analyticsError}
        </p>
      )}
      {timeDataError && (
        <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          {timeDataError} — showing analytics only.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Right now"
          value={timeDataError ? "—" : STATUS_LABEL[liveState.status]}
        />
        <StatCard
          label={`Worked (${days}d)`}
          value={timeDataError ? "—" : formatDuration(aggregate.worked_ms)}
          sub={timeDataError ? undefined : `${aggregate.days} day${aggregate.days === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Time off (YTD)"
          value={timeDataError ? "—" : `${fmtDays(timeOffYtd.total)} d`}
        />
        <StatCard
          label="Launcher events"
          value={
            analyticsLoading
              ? "…"
              : analytics?.totals.events.toLocaleString() ?? "0"
          }
          sub={
            analytics
              ? `${analytics.totals.app_launches.toLocaleString()} launches · ${analytics.totals.link_clicks.toLocaleString()} clicks`
              : undefined
          }
        />
        <StatCard
          label="Destinations"
          value={
            analyticsLoading
              ? "…"
              : analytics?.totals.unique_destinations.toLocaleString() ?? "0"
          }
        />
        <StatCard
          label="Incidents"
          value={timeDataError ? "—" : incidents.length.toString()}
          sub={
            timeDataError
              ? undefined
              : pendingIncidents > 0
                ? `${pendingIncidents} pending signature`
                : incidents.length > 0
                  ? "All signed"
                  : undefined
          }
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timesheet" disabled={!!timeDataError}>
            Timesheet
          </TabsTrigger>
          <TabsTrigger value="timeoff" disabled={!!timeDataError}>
            Time Off
          </TabsTrigger>
          <TabsTrigger value="incidents" disabled={!!timeDataError}>
            Incidents {incidents.length > 0 && `(${incidents.length})`}
          </TabsTrigger>
          <TabsTrigger value="apps">Apps</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Weekly schedule</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>Hours</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weekView.map((d) => (
                      <TableRow key={d.weekday}>
                        <TableCell className="font-medium">
                          {WEEKDAY_LABELS[d.weekday]}
                        </TableCell>
                        <TableCell>
                          {d.scheduled ? (
                            `${fmtTime(d.start)} – ${fmtTime(d.end)}`
                          ) : (
                            <span className="text-muted-foreground">Off</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Time off used — {new Date().getFullYear()}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {timeDataError ? (
                  <p className="text-sm text-muted-foreground">Not available.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {TIME_OFF_TYPES.map((t) => (
                      <MiniStat
                        key={t.value}
                        label={TIME_OFF_TYPE_LABEL[t.value]}
                        value={`${fmtDays(timeOffYtd[t.value as TimeOffType] || 0)} d`}
                      />
                    ))}
                    <MiniStat
                      label="Total"
                      value={`${fmtDays(timeOffYtd.total)} d`}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">First / last activity</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  First launcher event
                </div>
                <div className="text-sm mt-1">
                  {analytics?.totals.first_event
                    ? fmtDateTime(analytics.totals.first_event)
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Last launcher event
                </div>
                <div className="text-sm mt-1">
                  {analytics?.totals.last_event
                    ? `${fmtRelative(analytics.totals.last_event)} — ${fmtDateTime(analytics.totals.last_event)}`
                    : "—"}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timesheet" className="mt-4">
          <PunchesTab
            punches={punches}
            days={days}
            onDaysChange={setDays}
            loading={timeLoading}
          />
        </TabsContent>

        <TabsContent value="timeoff" className="mt-4">
          <TimeOffTab windowRows={timeOffWindow} ytd={timeOffYtd} />
        </TabsContent>

        <TabsContent value="incidents" className="mt-4">
          <IncidentsTab incidents={incidents} />
        </TabsContent>

        <TabsContent value="apps" className="mt-4">
          <AppsTab
            analytics={analytics}
            loading={analyticsLoading}
            range={range}
          />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <AuditTab analytics={analytics} loading={analyticsLoading} range={range} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------- sub-components ----------

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className="text-lg font-semibold mt-1 truncate" title={value}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className="text-base font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function PunchesTab({
  punches,
  days,
  onDaysChange,
  loading,
}: {
  punches: TimePunch[];
  days: number;
  onDaysChange: (n: number) => void;
  loading: boolean;
}) {
  const sorted = useMemo(
    () => [...punches].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1)),
    [punches],
  );
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">Time punches</CardTitle>
        <Select value={String(days)} onValueChange={(v) => onDaysChange(Number(v))}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 1 day</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No punches in the selected window.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap">
                    <div className="text-sm">{fmtDateTime(p.occurred_at)}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtRelative(p.occurred_at)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{EVENT_LABEL[p.event_type]}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.source}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.note ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TimeOffTab({
  windowRows,
  ytd,
}: {
  windowRows: WindowTimeOffRow[];
  ytd: YtdBreakdown;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            YTD breakdown — {new Date().getFullYear()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-6">
            {TIME_OFF_TYPES.map((t) => (
              <MiniStat
                key={t.value}
                label={TIME_OFF_TYPE_LABEL[t.value]}
                value={`${fmtDays(ytd[t.value as TimeOffType] || 0)} d`}
              />
            ))}
            <MiniStat label="Total" value={`${fmtDays(ytd.total)} d`} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Requests in window</CardTitle>
        </CardHeader>
        <CardContent>
          {windowRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No time-off requests in this window.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dates</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Length</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {windowRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {fmtDate(r.start_date + "T00:00:00")}
                      {r.start_date !== r.end_date && (
                        <> – {fmtDate(r.end_date + "T00:00:00")}</>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="w-fit">
                        {TIME_OFF_TYPE_LABEL[r.type]}
                      </Badge>
                      {r.subcategory && (
                        <div className="text-xs text-muted-foreground">
                          {r.subcategory}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.full_day
                        ? `${fmtDays(requestDays(r))} d`
                        : `${r.hours}h`}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "approved"
                            ? "default"
                            : r.status === "denied"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs">
                      {r.reason || r.decided_note || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function IncidentsTab({ incidents }: { incidents: IncidentSummary[] }) {
  if (incidents.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No incident reports on file.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Filed</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attachments</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {incidents.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {formatIncidentNumber(r.number)}
                </TableCell>
                <TableCell className="text-sm">{fmtDate(r.created_at)}</TableCell>
                <TableCell>
                  <Link
                    href={`/management/incidents?open=${r.id}`}
                    className="font-medium hover:underline"
                  >
                    {r.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {INCIDENT_CATEGORY_LABEL[r.category]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={SEVERITY_VARIANT[r.severity]}>
                    {INCIDENT_SEVERITY_LABEL[r.severity]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      (r.status as IncidentStatus) === "awaiting_employee_sig" ||
                      (r.status as IncidentStatus) === "awaiting_manager_sig"
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {INCIDENT_STATUS_LABEL[r.status as IncidentStatus]}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.attachments && r.attachments.length > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <Paperclip className="h-3 w-3" />
                      {r.attachments.length}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AppsTab({
  analytics,
  loading,
  range,
}: {
  analytics: AnalyticsPayload | null;
  loading: boolean;
  range: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const rows = analytics?.destinations ?? [];
    const q = query.toLowerCase().trim();
    return q ? rows.filter((d) => d.name.toLowerCase().includes(q)) : rows;
  }, [analytics, query]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Apps &amp; links used</CardTitle>
          <Input
            placeholder="Filter destinations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-xs"
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No launcher activity in the selected range.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Destination</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead>First used</TableHead>
                <TableHead>Last used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((d) => {
                const href = `/admin/analytics/${d.kind === "app" ? "apps" : "links"}/${d.id}?range=${range}`;
                return (
                  <TableRow key={`${d.kind}:${d.id}`} className="hover:bg-muted/50">
                    <TableCell className="font-medium">
                      <Link href={href} className="hover:underline">
                        {d.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={d.kind === "app" ? "default" : "outline"}
                        className="text-[10px]"
                      >
                        {d.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.count.toLocaleString()}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground text-sm"
                      title={fmtDateTime(d.first_used)}
                    >
                      {fmtRelative(d.first_used)}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground text-sm"
                      title={fmtDateTime(d.last_used)}
                    >
                      {fmtRelative(d.last_used)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AuditTab({
  analytics,
  loading,
  range,
}: {
  analytics: AnalyticsPayload | null;
  loading: boolean;
  range: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const rows = analytics?.audit_log ?? [];
    const q = query.toLowerCase().trim();
    return q ? rows.filter((e) => e.destination_name.toLowerCase().includes(q)) : rows;
  }, [analytics, query]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Recent events</CardTitle>
          <Input
            placeholder="Filter by destination…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-xs"
          />
        </div>
        {analytics?.audit_log_truncated && (
          <p className="text-xs text-muted-foreground">
            Showing latest 500 of {analytics.totals.events.toLocaleString()} events.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No events in the selected range.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Browser</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => {
                const href = e.destination_id
                  ? `/admin/analytics/${e.kind === "app" ? "apps" : "links"}/${e.destination_id}?range=${range}`
                  : null;
                return (
                  <TableRow key={e.id}>
                    <TableCell
                      className="text-muted-foreground whitespace-nowrap"
                      title={fmtDateTime(e.created_at)}
                    >
                      {fmtRelative(e.created_at)}
                    </TableCell>
                    <TableCell>
                      {href ? (
                        <Link href={href} className="hover:underline">
                          {e.destination_name}
                        </Link>
                      ) : (
                        e.destination_name
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={e.kind === "app" ? "default" : "outline"}
                        className="text-[10px]"
                      >
                        {e.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {e.ip_address ?? "—"}
                    </TableCell>
                    <TableCell
                      className="text-xs text-muted-foreground"
                      title={e.user_agent ?? undefined}
                    >
                      {shortenAgent(e.user_agent)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function emptyYtd(): YtdBreakdown {
  return { vacation: 0, sick: 0, personal: 0, parental: 0, other: 0, total: 0 };
}
