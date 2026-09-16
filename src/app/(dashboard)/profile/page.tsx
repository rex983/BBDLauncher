import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { computeState, formatDuration, STATUS_LABEL, type TimePunch } from "@/lib/timesheets/state";
import { computeDayWorkedMs } from "@/lib/timesheets/weekly";
import { startOfDayInZone, localDateInZone } from "@/lib/timesheets/tz";
import { TimeOffPanel, type TimeOffRequest } from "@/components/features/timeoff/TimeOffPanel";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_START = "10:00";
const DEFAULT_END = "18:00";
const DEFAULT_WORKDAYS = new Set([1, 2, 3, 4, 5]);

type ScheduleRow = {
  weekday: number;
  start_time: string;
  end_time: string;
  timezone: string;
};

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

function fmtTime(t: string) {
  // HH:MM(:SS) -> h:mm AM/PM
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const period = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return `${displayH}:${String(m).padStart(2, "0")} ${period}`;
}

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const profileId = session.user.profileId;

  const supabase = createAdminClient();

  // 14-day window for hours + activity. Day boundaries follow ET so
  // "today" here matches what the timesheet stack reports.
  const now = new Date();
  const startOfToday = startOfDayInZone(now);
  const from14 = new Date(startOfToday); from14.setDate(from14.getDate() - 14);

  const [profileRes, schedulesRes, punches14Res, timeoffRes, launchesRes] = await Promise.all([
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
      .select("id, type, subcategory, start_date, end_date, full_day, hours, status, reason, decided_note, created_at")
      .eq("profile_id", profileId)
      .order("start_date", { ascending: false })
      .limit(20),
    supabase
      .from("launcher_sso_audit_log")
      .select("created_at, event_type, details")
      .eq("user_id", profileId)
      .gte("created_at", from14.toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const profile = profileRes.data;
  const schedules = (schedulesRes.data || []) as ScheduleRow[];
  const punches14 = (punches14Res.data || []) as TimePunch[];
  const timeoff = (timeoffRes.data || []) as TimeOffRequest[];
  const launches = (launchesRes.data || []) as LaunchRow[];

  // Full-week schedule with default-fallback: if the user has ANY override,
  // treat missing weekdays as "not scheduled"; otherwise default to Mon-Fri 10-6.
  const hasAnyOverride = schedules.length > 0;
  const scheduleByWeekday = new Map(schedules.map((s) => [s.weekday, s]));
  const weekView = [0, 1, 2, 3, 4, 5, 6].map((wd) => {
    const override = scheduleByWeekday.get(wd);
    if (override) {
      return { weekday: wd, scheduled: true, start: override.start_time.slice(0, 5), end: override.end_time.slice(0, 5), tz: override.timezone };
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

  // Today's live state (a subset of the 14d punches).
  const todayPunches = punches14.filter((p) => new Date(p.occurred_at) >= startOfToday);
  const todayState = computeState(todayPunches, now);

  // 14-day totals: bucket punches by ET-local day, fold each day
  // independently with the day-end cap so stranded open shifts don't leak.
  const dayBuckets = new Map<string, TimePunch[]>();
  for (const p of punches14) {
    const key = localDateInZone(new Date(p.occurred_at));
    const list = dayBuckets.get(key) || [];
    list.push(p);
    dayBuckets.set(key, list);
  }
  let worked14 = 0;
  let lunch14 = 0;
  let break14 = 0;
  const todayKey = localDateInZone(now);
  for (const [dayKey, list] of dayBuckets) {
    worked14 += computeDayWorkedMs(list, dayKey, now);
    // Lunch/break spans use the same cap semantics.
    const capNow = dayKey === todayKey ? now : new Date(startOfToday);
    if (dayKey !== todayKey) {
      const [y, m, d] = dayKey.split("-").map(Number);
      const dayEnd = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
      capNow.setTime(dayEnd.getTime());
    }
    const s = computeState(list, capNow);
    lunch14 += s.lunch_ms;
    break14 += s.break_ms;
  }
  const workedDays = dayBuckets.size;

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
                      ? `${fmtTime(d.start)} – ${fmtTime(d.end)}`
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
            {hasAnyOverride
              ? "Your manager has set custom hours. Contact them to adjust."
              : "Using the default schedule (Mon–Fri, 10:00 AM – 6:00 PM ET). Your manager can customize this."}
          </p>
        </CardContent>
      </Card>

      <TimeOffPanel
        initialRequests={timeoff}
        title="My time off"
        description="Submit new requests and see the status of past ones."
      />

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
