"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ANALYTICS_RANGE_OPTIONS } from "@/lib/analytics/ranges";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Clock, Eye, Pencil, UserCheck, UserX } from "lucide-react";
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
  emptyTimeOffTotals,
  formatDays,
  TIME_OFF_TYPE_LABEL,
  TIME_OFF_TYPES,
} from "@/lib/timeoff/types";
import type { IncidentSummary } from "@/components/features/incidents/IncidentPanel";
import type {
  EmployeeDetailData,
  WindowTimeOffRow,
  YtdBreakdown,
} from "@/lib/timesheets/detail";
import { fmtDateTimeUS as fmtDateTime, fmtDateUS as fmtDate, fmtRelative } from "@/components/shared/format";
import { rangeToDays, type AnalyticsPayload } from "./profile360-helpers";
import { aggregatePunches } from "@/lib/timesheets/weekly";
import {
  buildWeekView,
  formatClockTime,
  WEEKDAY_LABELS,
  workdaysFrom,
} from "@/lib/timesheets/schedule";
import {
  AppsTab,
  AuditTab,
  IncidentsTab,
  MiniStat,
  PunchesTab,
  TimeOffTab,
} from "./profile360-parts";
import { StatCard } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";
import type { OrgItem } from "@/lib/org/constants";
import type { PersonSummary } from "@/lib/people/summary";
import { PersonAvatar } from "@/components/features/people/person-avatar";
import { PersonLink } from "@/components/features/people/person-peek";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";
import { UserFormDialog, type LauncherRole } from "./user-form-dialog";
import { useUserActions } from "./user-actions";

interface WorkScheduleRow {
  weekday: number;
  start_time: string;
  end_time: string;
  timezone: string;
}

export function UserProfile360Shell({
  userId,
  initialRange,
  person,
  roles,
  offices,
  departments,
  initialDays,
  timeData,
  timeDataError,
  workSchedule,
  incidents,
}: {
  userId: string;
  initialRange: string;
  /** Who they are, and what this viewer may see and do (src/lib/people/summary.ts). */
  person: PersonSummary;
  roles: LauncherRole[];
  offices: OrgItem[];
  departments: OrgItem[];
  initialDays: number;
  timeData: EmployeeDetailData | null;
  timeDataError: string | null;
  workSchedule: WorkScheduleRow[];
  incidents: IncidentSummary[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setViewAsUser } = useRolePreview();
  const { data: session } = useSession();
  const viewerIsAdmin = session?.user?.permRole === "admin";
  const isSelf = session?.user?.profileId === userId;
  const analyticsAllowed = person.can.activity;
  const [editOpen, setEditOpen] = useState(false);
  const actions = useUserActions(() => router.refresh());

  const [range, setRange] = useState(initialRange);
  const [tab, setTab] = useState("overview");
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(person.can.activity);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  const [days, setDays] = useState(initialDays);
  const [punches, setPunches] = useState<TimePunch[]>(timeData?.punches ?? []);
  const [timeOffWindow, setTimeOffWindow] = useState<WindowTimeOffRow[]>(
    timeData?.time_off.window ?? [],
  );
  const [timeOffYtd, setTimeOffYtd] = useState<YtdBreakdown>(
    timeData?.time_off.ytd ?? emptyTimeOffTotals(),
  );
  const [timeLoading, setTimeLoading] = useState(false);
  // `incidents` is hydrated server-side — this page doesn't poll. Filed or
  // signed incidents show on a hard refresh; /management/incidents is the
  // live queue.

  useEffect(() => {
    if (!analyticsAllowed) return;
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
  }, [range, userId, analyticsAllowed]);

  // Latest request wins, so a slow 30-day load can't overwrite a newer 7-day one.
  const loadSeq = useRef(0);
  const loadTime = useCallback(async () => {
    if (timeDataError) return;
    const seq = ++loadSeq.current;
    setTimeLoading(true);
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);
    const url = `/api/management/timesheets/employee/${userId}?from=${from.toISOString()}&to=${now.toISOString()}`;
    const res = await fetch(url);
    if (seq !== loadSeq.current) return;
    if (res.ok) {
      const data = await res.json();
      if (seq !== loadSeq.current) return;
      setPunches(data.punches);
      if (data.time_off) {
        setTimeOffWindow(data.time_off.window ?? []);
        setTimeOffYtd(data.time_off.ytd ?? emptyTimeOffTotals());
      }
    }
    setTimeLoading(false);
  }, [userId, days, timeDataError]);

  // Refetch whenever the window changes from what's loaded (the server
  // hydrated initialDays, so the first render doesn't load twice).
  const loadedDays = useRef(initialDays);
  useEffect(() => {
    if (days === loadedDays.current) return;
    loadedDays.current = days;
    loadTime();
  }, [days, loadTime]);

  // The header range drives the timesheet window too; the Timesheet tab's own
  // picker can then narrow or widen it independently.
  const changeRange = (next: string) => {
    setRange(next);
    setDays(rangeToDays(next));
  };

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("range") !== range) {
      params.set("range", range);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [range, router, searchParams]);

  const displayName = person.name || person.email;
  const canEdit = person.can.manage || isSelf;
  const canRetire = person.can.manage && !isSelf;
  const startViewAs = () => {
    if (!person.view_as) return;
    setViewAsUser(person.view_as);
    router.push(`/dashboard?viewAsUser=${person.id}`);
  };
  const liveState = useMemo(() => computeState(punches), [punches]);
  const aggregate = useMemo(() => aggregatePunches(punches), [punches]);

  const weekView = buildWeekView(workSchedule);

  const pendingIncidents = incidents.filter(
    (i) => i.status === "awaiting_manager_sig" || i.status === "awaiting_employee_sig",
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href="/admin/users">
            <ArrowLeft className="h-4 w-4" />
            Users
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-5">
            <PersonAvatar
              profileId={person.id}
              name={displayName}
              size={96}
              hasPhoto={person.has_photo}
              className="ring-2 ring-border"
            />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold">{displayName}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <a href={`mailto:${person.email}`} className="hover:underline">
                  {person.email}
                </a>
                {!timeDataError && person.is_active && (
                  <span className="inline-flex items-center gap-1.5">
                    <span>·</span>
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        liveState.status === "working"
                          ? "bg-emerald-500"
                          : liveState.status === "clocked_out"
                            ? "bg-muted-foreground/40"
                            : "bg-amber-500",
                      )}
                    />
                    {STATUS_LABEL[liveState.status]}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{person.role_label}</Badge>
                {person.office_label && <Badge variant="outline">{person.office_label}</Badge>}
                {person.department_label && person.department_label !== person.office_label && (
                  <Badge variant="outline">{person.department_label}</Badge>
                )}
                {person.is_it && <Badge>IT</Badge>}
                {person.can_offboard && <Badge variant="outline">Offboarding</Badge>}
                {!person.is_active && <Badge variant="destructive">Inactive</Badge>}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {person.team && (
                  <>
                    {person.team.name}
                    {person.team.leader_id && person.team.leader_id !== person.id && person.team.leader_name && (
                      <>
                        {" · led by "}
                        <PersonLink id={person.team.leader_id} name={person.team.leader_name} />
                      </>
                    )}
                    {" · "}
                  </>
                )}
                {person.leads.length > 0 && <>Leads {person.leads.join(", ")} · </>}
                Added {fmtDate(person.created_at)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
            )}
            {person.can.time && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/management/timesheets/${person.id}`}>
                  <Clock className="h-4 w-4" />
                  Timesheet
                </Link>
              </Button>
            )}
            {person.view_as && (
              <Button variant="outline" size="sm" onClick={startViewAs}>
                <Eye className="h-4 w-4" />
                View as
              </Button>
            )}
            {canRetire && (
              <Button variant="outline" size="sm" onClick={() => actions.askToggleActive(person)}>
                {person.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                {person.is_active ? "Deactivate" : "Reactivate"}
              </Button>
            )}
            {(analyticsAllowed || !timeDataError) && (
              <Select value={range} onValueChange={changeRange}>
                <SelectTrigger className="h-8 w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANALYTICS_RANGE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      <UserFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editing={editOpen ? person : null}
        roles={roles}
        offices={offices}
        departments={departments}
        viewerIsAdmin={viewerIsAdmin}
        viewerOffice={session?.user?.office ?? null}
        onSaved={() => router.refresh()}
      />
      {actions.dialog}

      {analyticsError && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {analyticsError}
        </p>
      )}
      {(timeDataError || !analyticsAllowed) && (
        <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          {timeDataError && !analyticsAllowed
            ? "You can see who this is, but their time and launcher activity are outside your office or department."
            : timeDataError
              ? `${timeDataError} Showing launcher activity only.`
              : "Their launcher activity is outside your office. Showing time data only."}
        </p>
      )}

      {(analyticsAllowed || !timeDataError) && (
      <>
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
          value={timeDataError ? "—" : `${formatDays(timeOffYtd.total)} d`}
        />
        {analyticsAllowed && <StatCard
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
        />}
        {analyticsAllowed && <StatCard
          label="Destinations"
          value={
            analyticsLoading
              ? "…"
              : analytics?.totals.unique_destinations.toLocaleString() ?? "0"
          }
        />}
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
          {analyticsAllowed && <TabsTrigger value="apps">Apps</TabsTrigger>}
          {analyticsAllowed && <TabsTrigger value="audit">Audit Log</TabsTrigger>}
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
                            `${formatClockTime(d.start)} – ${formatClockTime(d.end)}`
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
                        value={`${formatDays(timeOffYtd[t.value] || 0)} d`}
                      />
                    ))}
                    <MiniStat
                      label="Total"
                      value={`${formatDays(timeOffYtd.total)} d`}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          {analyticsAllowed && <Card>
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
                    ? `${fmtRelative(analytics.totals.last_event, fmtDate)} — ${fmtDateTime(analytics.totals.last_event)}`
                    : "—"}
                </div>
              </div>
            </CardContent>
          </Card>}
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
          <TimeOffTab
            windowRows={timeOffWindow}
            ytd={timeOffYtd}
            workdays={workdaysFrom(workSchedule)}
            holidays={new Set(timeData?.time_off.holidays ?? [])}
          />
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
      </>
      )}
    </div>
  );
}
