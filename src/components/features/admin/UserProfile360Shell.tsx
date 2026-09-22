"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  type TimePunch,
} from "@/lib/timesheets/state";
import {
  TIME_OFF_TYPE_LABEL,
  TIME_OFF_TYPES,
  type TimeOffType,
} from "@/lib/timeoff/types";
import type { IncidentSummary } from "@/components/features/incidents/IncidentPanel";
import type {
  EmployeeDetailData,
  WindowTimeOffRow,
  YtdBreakdown,
} from "@/lib/timesheets/detail";
import {
  aggregatePunches,
  DEFAULT_END,
  DEFAULT_START,
  DEFAULT_WORKDAYS,
  emptyYtd,
  fmtDate,
  fmtDateTime,
  fmtDays,
  fmtRelative,
  fmtTime,
  RANGES,
  rangeToDays,
  WEEKDAY_LABELS,
  type AnalyticsPayload,
} from "./profile360-helpers";
import {
  AppsTab,
  AuditTab,
  IncidentsTab,
  MiniStat,
  PunchesTab,
  StatCard,
  TimeOffTab,
} from "./profile360-parts";

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

  useEffect(() => {
    const next = rangeToDays(range);
    if (next !== days) setDays(next);
  }, [range, days]);

  // Incidents are hydrated server-side — this page doesn't poll. Filed or
  // signed incidents will show on a hard refresh; the /management/incidents
  // page is the live queue.
  void setIncidents;

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("range") !== range) {
      params.set("range", range);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [range, router, searchParams]);

  const displayName = profile?.name ?? profile?.email ?? "Unknown user";
  const liveState = useMemo(() => computeState(punches), [punches]);
  const aggregate = useMemo(() => aggregatePunches(punches), [punches]);

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
