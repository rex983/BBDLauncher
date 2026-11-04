import { auth } from "@/auth";
import type { UserRole } from "@/types/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { computeState, formatDuration, STATUS_LABEL, type TimePunch } from "@/lib/timesheets/state";
import { aggregatePunches } from "@/lib/timesheets/weekly";
import { startOfDayInZone, localDateInZone } from "@/lib/timesheets/tz";
import {
  buildWeekView,
  formatClockTime,
  WEEKDAY_LABELS,
  workdaysFrom,
  type WorkScheduleRow,
} from "@/lib/timesheets/schedule";
import { TimeOffPanel, type TimeOffRequest } from "@/components/features/timeoff/TimeOffPanel";
import {
  IncidentPanel,
  type IncidentSummary,
} from "@/components/features/incidents/IncidentPanel";
import { MemoPanel } from "@/components/features/memos/MemoPanel";
import { canViewAs } from "@/lib/launcher/view-as";
import { resolveAppsOnly } from "@/lib/auth/perm-role";
import { MyGoalsCard, TeamReportsCard } from "@/components/features/goals/MyGoals";
import { listMemosForEmployee } from "@/lib/memos/queries";
import {
  formatDays,
  requestDays,
  TIME_OFF_TYPE_LABEL,
  TIME_OFF_TYPES,
  type TimeOffType,
} from "@/lib/timeoff/types";

type LaunchRow = {
  created_at: string;
  event_type: string;
  details: { app_name?: string; link_title?: string; url?: string } | null;
};

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString([], {
    month: "short", day: "numeric", year: "numeric",
  });
}

const UUID = /^[0-9a-f-]{36}$/i;

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ viewAsUser?: string | string[] }>;
}) {
  const [session, sp] = await Promise.all([auth(), searchParams]);
  if (!session?.user) redirect("/login");
  const supabase = createAdminClient();

  // View as (?viewAsUser=): their profile exactly as they see it, when the
  // viewer may View as them (migration 052's rule); nothing on it saves.
  // Anyone else's id, or a failed check, is the viewer's own profile.
  const asId = Array.isArray(sp.viewAsUser) ? sp.viewAsUser[0] : sp.viewAsUser;
  const viewingAs = !!asId && UUID.test(asId) && asId !== session.user.profileId && (await canViewAs(session.user.profileId, asId)) === true;
  const profileId = viewingAs ? asId! : session.user.profileId;
  // "Apps only" roles (migration 062) see only the apps grid.
  const appsOnly = viewingAs
    ? await supabase
        .from("profiles")
        .select("role")
        .eq("id", profileId)
        .single()
        .then(({ data }) => resolveAppsOnly((data?.role as UserRole | undefined) ?? null))
    : session.user.appsOnly;
  if (appsOnly) redirect(viewingAs ? `/dashboard?viewAsUser=${profileId}` : "/dashboard");

  // 14-day window for hours + activity. Day boundaries follow ET so
  // "today" here matches what the timesheet stack reports.
  const now = new Date();
  const startOfToday = startOfDayInZone(now);
  const from14 = new Date(startOfToday); from14.setDate(from14.getDate() - 14);
  const currentYear = now.getFullYear();
  const yearStart = `${currentYear}-01-01`;

  const [profileRes, schedulesRes, punches14Res, timeoffRes, launchesRes, ytdApprovedRes, incidentsRes, memoRows] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, name:full_name, role, office, department, is_it, created_at")
      .eq("id", profileId)
      .single(),
    supabase
      .from("work_schedules")
      .select("weekday, start_time, end_time, timezone")
      .eq("profile_id", profileId),
    supabase
      .from("time_punches")
      .select("id, profile_id, event_type, occurred_at, source, note")
      .eq("profile_id", profileId)
      .gte("occurred_at", from14.toISOString())
      .order("occurred_at", { ascending: true }),
    supabase
      .from("time_off_requests")
      .select("id, type, subcategory, start_date, end_date, full_day, hours, status, reason, decided_note, created_at, attachments")
      .eq("profile_id", profileId)
      // Only rows whose window hasn't fully closed yet — end_date >= today
      // in ET. Past requests get out of the way so this panel stays
      // focused on what's coming up. Includes denied so the user always
      // sees the outcome of a pending decision.
      .gte("end_date", localDateInZone(now))
      .order("start_date", { ascending: true })
      .limit(20),
    supabase
      .from("launcher_sso_audit_log")
      .select("created_at, event_type, details")
      .eq("user_id", profileId)
      .gte("created_at", from14.toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
    // YTD approved time off — powers the "Time off used" card. Filter on
    // start_date so requests that started this year (and only this year)
    // count. A request spanning last Dec → this Jan is rare enough that
    // we don't try to split it across years here.
    supabase
      .from("time_off_requests")
      .select("type, start_date, end_date, full_day, hours")
      .eq("profile_id", profileId)
      .eq("status", "approved")
      .gte("start_date", yearStart)
      .order("start_date", { ascending: false })
      .limit(200),
    // Employee's own incident reports — only awaiting-sig or completed
    // (drafts + awaiting-manager-sig are still manager-internal). Matches
    // the visibility rule the /api/incidents endpoint enforces.
    supabase
      .from("incident_reports")
      .select(
        "id, number, title, severity, category, status, occurred_at, manager_signed_at, employee_signed_at, attachments, created_at",
      )
      .eq("employee_profile_id", profileId)
      .in("status", ["awaiting_employee_sig", "completed"])
      .order("created_at", { ascending: false })
      .limit(50),
    listMemosForEmployee({ supabase, profileId }),
  ]);

  const profile = profileRes.data;
  const schedules = (schedulesRes.data || []) as WorkScheduleRow[];
  const punches14 = (punches14Res.data || []) as TimePunch[];
  const timeoff = (timeoffRes.data || []) as TimeOffRequest[];
  const launches = (launchesRes.data || []) as LaunchRow[];
  const ytdApproved = (ytdApprovedRes.data || []) as {
    type: TimeOffType;
    start_date: string;
    end_date: string;
    full_day: boolean;
    hours: number | null;
  }[];
  const incidents = (incidentsRes.data || []) as IncidentSummary[];

  // Fold approved rows into days-per-type. `requestDays` handles
  // full-day (scheduled-workday count) vs partial-day (hours/8) semantics.
  const workdays = workdaysFrom(schedules);
  const daysByType = new Map<TimeOffType, number>();
  for (const t of TIME_OFF_TYPES) daysByType.set(t.value, 0);
  let totalDaysOff = 0;
  for (const r of ytdApproved) {
    const d = requestDays(r, workdays);
    daysByType.set(r.type, (daysByType.get(r.type) || 0) + d);
    totalDaysOff += d;
  }

  const weekView = buildWeekView(schedules);

  // Today's live state (a subset of the 14d punches).
  const todayPunches = punches14.filter((p) => new Date(p.occurred_at) >= startOfToday);
  const todayState = computeState(todayPunches, now);

  // 14-day totals, folded per ET-local day.
  const {
    worked_ms: worked14,
    lunch_ms: lunch14,
    break_ms: break14,
    days: workedDays,
  } = aggregatePunches(punches14, now);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">
          {profile?.name || profile?.email || "My profile"}
        </h1>
        <div className="text-sm text-muted-foreground mt-1 flex flex-wrap items-center gap-2">
          <span>{profile?.email}</span>
          {profile?.role && <><span>·</span><Badge variant="secondary">{profile.role}</Badge></>}
          {profile?.office && <><span>·</span><Badge variant="outline">{profile.office}</Badge></>}
          {profile?.department && <><span>·</span><Badge variant="outline">{profile.department}</Badge></>}
          {profile?.is_it && <><span>·</span><Badge>IT</Badge></>}
        </div>
        {profile?.created_at && (
          <p className="text-xs text-muted-foreground mt-2">
            Joined {fmtDate(profile.created_at.slice(0, 10))}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Right now" value={STATUS_LABEL[todayState.status]} />
        <Stat label="Today worked" value={formatDuration(todayState.worked_ms)} />
        <Stat label="Last 14d worked" value={formatDuration(worked14)} sub={`${workedDays} day${workedDays === 1 ? "" : "s"}`} />
        <Stat label="Last 14d lunch + breaks" value={formatDuration(lunch14 + break14)} />
      </div>

      <MyGoalsCard asProfileId={viewingAs ? profileId : undefined} />
      <TeamReportsCard asProfileId={viewingAs ? profileId : undefined} />

      <Card>
        <CardHeader>
          <CardTitle>Weekly schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Timezone</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {weekView.map((d) => (
                <TableRow key={d.weekday}>
                  <TableCell className="font-medium">{WEEKDAY_LABELS[d.weekday]}</TableCell>
                  <TableCell>
                    {d.scheduled
                      ? `${formatClockTime(d.start)} – ${formatClockTime(d.end)}`
                      : <span className="text-muted-foreground">Off</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {d.scheduled ? d.tz : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-3">
            {schedules.length > 0
              ? "Your manager has set custom hours. Contact them to adjust."
              : "Using the default schedule (Mon–Fri, 10:00 AM – 6:00 PM ET). Your manager can customize this."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Time off used — {currentYear}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {TIME_OFF_TYPES.map((t) => (
              <Stat
                key={t.value}
                label={TIME_OFF_TYPE_LABEL[t.value]}
                value={`${formatDays(daysByType.get(t.value) || 0)} d`}
              />
            ))}
            <Stat label="Total" value={`${formatDays(totalDaysOff)} d`} />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Approved days only. Partial-day requests count as hours ÷ 8.
          </p>
        </CardContent>
      </Card>

      <TimeOffPanel
        initialRequests={timeoff}
        upcomingOnly
        readOnly={viewingAs}
        title="My upcoming time off"
        description="Submit new requests and see the status of ones that haven't happened yet."
      />

      {/* Always render — the bell links to #incidents when a manager files
          one, and an empty panel with a "nothing here" message is a fine
          landing spot instead of a 404-in-page. */}
      <div id="incidents" className="scroll-mt-20">
        <IncidentPanel
          initialRows={incidents}
          employeeFullName={profile?.name || null}
          readOnly={viewingAs}
          viewAsProfileId={viewingAs ? profileId : undefined}
          title="Incident reports"
          description="Reports issued to you. Sign any awaiting your signature; archived reports remain viewable here."
        />
      </div>

      <div id="memos" className="scroll-mt-20">
        <MemoPanel
          initialRows={memoRows}
          title="Office memos"
          description="Memos delivered to you. Acknowledge any that require it; the rest are here for reference."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent app activity</CardTitle>
        </CardHeader>
        <CardContent>
          {launches.length === 0 ? (
            <p className="text-muted-foreground text-sm">No app launches in the last 14 days.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {launches.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(l.created_at).toLocaleString([], {
                        month: "short", day: "numeric",
                        hour: "numeric", minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{l.event_type.replace("_", " ")}</Badge>
                    </TableCell>
                    <TableCell>
                      {l.details?.app_name || l.details?.link_title || l.details?.url || "—"}
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
