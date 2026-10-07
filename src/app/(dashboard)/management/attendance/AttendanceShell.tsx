"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { SortHeader } from "@/components/ui/sort-header";
import { ExportMenu } from "@/components/ui/export-menu";
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
import { useSortableRows } from "@/lib/hooks/use-sortable-rows";
import { cn } from "@/lib/utils";
import { fmtDay, fmtTime } from "@/components/shared/format";
import { formatClockTime } from "@/lib/timesheets/schedule";
import { DEPARTMENTS, OFFICES } from "@/lib/org/constants";
import { ATTENDANCE_RANGES } from "@/lib/timesheets/attendance-ranges";
import type {
  AttendanceDayPerson,
  AttendanceEvent,
  AttendanceEventKind,
  AttendanceReport,
  EmployeeAttendance,
} from "@/lib/timesheets/attendance";
import {
  ArrivalTimesChart,
  ArrivalsDonut,
  ChartCard,
  DailyArrivalsChart,
  DayBreakdown,
  arrivalNote,
  LeaderChart,
  STATUS_COLOR,
  WeekdayChart,
} from "./AttendanceCharts";

const ALL = "__all__";
const PAGE = 50;

const KIND: Record<AttendanceEventKind, { label: string; color: string }> = {
  late: { label: "Late", color: STATUS_COLOR.late },
  absent: { label: "Absent", color: STATUS_COLOR.absent },
  early_leave: { label: "Left early", color: "#f97316" },
  overtime: { label: "Stayed late", color: STATUS_COLOR.overtime },
  weekly_overtime: { label: "Over 40h", color: "#6d28d9" },
  missed_clockout: { label: "No clock-out", color: "#64748b" },
  unscheduled: { label: "Day off worked", color: STATUS_COLOR.time_off },
};
const KIND_ORDER = Object.keys(KIND) as AttendanceEventKind[];

function mins(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

function hours(m: number): string {
  return (m / 60).toFixed(1);
}

function eventDetail(e: AttendanceEvent): string {
  const sched = e.scheduled ? formatClockTime(e.scheduled) : "";
  const at = e.at ? fmtTime(e.at) : "";
  switch (e.kind) {
    case "late":
      return `${mins(e.minutes)} late · in at ${at} (shift ${sched})`;
    case "absent":
      return `No clock-in (shift ${sched})`;
    case "early_leave":
      return `${mins(e.minutes)} early · out at ${at} (shift ends ${sched})`;
    case "overtime":
      return e.live
        ? `${mins(e.minutes)} past ${sched} · still on the clock`
        : `${mins(e.minutes)} past ${sched} · out at ${at}`;
    case "weekly_overtime":
      return `${mins(e.minutes)} over 40 hours that week`;
    case "missed_clockout":
      return "Forgot to clock out · closed automatically";
    case "unscheduled":
      return `Worked ${mins(e.minutes)} on a day off`;
  }
}

type EmpKey =
  | "name"
  | "days"
  | "rate"
  | "late"
  | "avg"
  | "absent"
  | "early"
  | "overtime"
  | "weekly"
  | "missed";

const onTimeRate = (e: EmployeeAttendance) =>
  e.on_time + e.late ? Math.round((e.on_time / (e.on_time + e.late)) * 100) : null;

const EMP_GETTERS: Record<EmpKey, (e: EmployeeAttendance) => string | number | null> = {
  name: (e) => e.name,
  days: (e) => e.scheduled_days,
  rate: onTimeRate,
  late: (e) => e.late,
  avg: (e) => (e.late ? e.late_minutes / e.late : 0),
  absent: (e) => e.absent,
  early: (e) => e.early_leaves,
  overtime: (e) => e.overtime_minutes,
  weekly: (e) => e.weekly_overtime_minutes,
  missed: (e) => e.missed_clockouts,
};

export default function AttendanceShell({
  report,
  isAdmin,
  office,
  department,
}: {
  report: AttendanceReport;
  isAdmin: boolean;
  office: string | null;
  department: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const totals = useMemo(() => {
    const t = {
      on_time: 0, late: 0, absent: 0, time_off: 0, late_minutes: 0,
      early: 0, overtime: 0, weekly: 0, overWeeks: 0, missed: 0,
    };
    for (const e of report.employees) {
      t.on_time += e.on_time;
      t.late += e.late;
      t.absent += e.absent;
      t.time_off += e.time_off;
      t.late_minutes += e.late_minutes;
      t.early += e.early_leaves;
      t.overtime += e.overtime_minutes;
      t.weekly += e.weekly_overtime_minutes;
      t.missed += e.missed_clockouts;
    }
    t.overWeeks = report.events.filter((e) => e.kind === "weekly_overtime").length;
    return t;
  }, [report]);

  const arrived = totals.on_time + totals.late;
  const { sorted: employees, sort, toggle } = useSortableRows<EmployeeAttendance, EmpKey>(report.employees, EMP_GETTERS, {
    key: "late",
    direction: "desc",
  });

  // Event log filters: kind toggles (all on by default), person, free text.
  const [hidden, setHidden] = useState<Set<AttendanceEventKind>>(new Set());
  const [person, setPerson] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [todayOpen, setTodayOpen] = useState(false);
  const todayDay = report.daily.find((d) => d.date === report.to);
  const todayPeople = (status: AttendanceDayPerson["status"]) =>
    (todayDay?.people ?? []).filter((p) => p.status === status).map((p) => ({ ...p, note: arrivalNote(p) }));
  const toggleToday = () => setTodayOpen((o) => !o);

  const kindCounts = useMemo(() => {
    const c = Object.fromEntries(KIND_ORDER.map((k) => [k, 0])) as Record<AttendanceEventKind, number>;
    for (const e of report.events) if (!person || e.profile_id === person) c[e.kind]++;
    return c;
  }, [report.events, person]);

  const events = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return report.events.filter(
      (e) =>
        !hidden.has(e.kind) &&
        (!person || e.profile_id === person) &&
        (!needle ||
          e.name.toLowerCase().includes(needle) ||
          (e.reason ?? "").toLowerCase().includes(needle)),
    );
  }, [report.events, hidden, person, q]);

  const toggleKind = (k: AttendanceEventKind) => {
    setShown(PAGE);
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const personName = person ? report.employees.find((e) => e.profile_id === person)?.name : null;

  return (
    <div className={cn("space-y-6 transition-opacity", pending && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Attendance</h1>
          <p className="text-muted-foreground">
            Late arrivals, overtime, early exits and absences ·{" "}
            {report.from === report.to ? fmtDay(report.from) : `${fmtDay(report.from)} – ${fmtDay(report.to)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5">
            {ATTENDANCE_RANGES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setParam("days", d === 30 ? null : String(d))}
                className={cn(
                  "rounded px-3 py-1 text-sm font-medium transition-colors",
                  report.days === d
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {d === 1 ? "Today" : `${d}d`}
              </button>
            ))}
          </div>
          {isAdmin ? (
            <>
              <Select value={office ?? ALL} onValueChange={(v) => setParam("office", v === ALL ? null : v)}>
                <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All offices</SelectItem>
                  {OFFICES.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select
                value={department ?? ALL}
                onValueChange={(v) => setParam("department", v === ALL ? null : v)}
              >
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All departments</SelectItem>
                  {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </>
          ) : (
            <>
              <Badge variant="outline">{office ?? "—"}</Badge>
              <Badge variant="outline">{department ?? "—"}</Badge>
            </>
          )}
        </div>
      </div>

      {/* Today at a glance */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-4 py-3 text-sm">
        <span className="font-semibold">Today</span>
        <TodayStat color={STATUS_COLOR.on_time} n={report.today.on_time} label="on time" people={todayPeople("on_time")} onClick={toggleToday} />
        <TodayStat color={STATUS_COLOR.late} n={report.today.late} label="late" people={todayPeople("late")} onClick={toggleToday} />
        <TodayStat color={STATUS_COLOR.absent} n={report.today.not_in} label="not in yet" people={todayPeople("not_in")} onClick={toggleToday} />
        <TodayStat color={STATUS_COLOR.time_off} n={report.today.time_off} label="time off" people={todayPeople("time_off")} onClick={toggleToday} />
        <TodayStat
          className="ml-auto"
          popupClassName="right-0 left-auto"
          n={report.today.on_clock}
          label="on the clock now"
          people={report.today.on_clock_people}
          onClick={toggleToday}
        />
      </div>
      {todayOpen && todayDay && <DayBreakdown day={todayDay} onClose={() => setTodayOpen(false)} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard
          label="On-time rate"
          value={arrived ? `${Math.round((totals.on_time / arrived) * 100)}%` : "—"}
          sub={`${totals.on_time} of ${arrived} arrivals`}
        />
        <StatCard
          label="Late arrivals"
          value={String(totals.late)}
          sub={totals.late ? `avg ${mins(Math.round(totals.late_minutes / totals.late))} late` : undefined}
          highlight={totals.late > 0}
        />
        <StatCard label="Absences" value={String(totals.absent)} sub="no clock-in, no time off" highlight={totals.absent > 0} />
        <StatCard label="Left early" value={String(totals.early)} />
        <StatCard label="Stayed past shift" value={`${hours(totals.overtime)}h`} />
        <StatCard
          label="Over 40h weeks"
          value={String(totals.overWeeks)}
          sub={totals.weekly ? `${hours(totals.weekly)}h overtime` : undefined}
        />
        <StatCard label="Missed clock-outs" value={String(totals.missed)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Arrivals" sub="Scheduled days in range">
          <ArrivalsDonut totals={totals} />
        </ChartCard>
        <ChartCard title="Arrivals by day" sub="Hover a day for who was late or out; click it for everyone" className="lg:col-span-2">
          <DailyArrivalsChart daily={report.daily} />
        </ChartCard>
        <ChartCard title="Clock-in vs. shift start" sub="On time = within 59 seconds">
          <ArrivalTimesChart arrivals={report.arrivals} />
        </ChartCard>
        <ChartCard title="Late rate by weekday">
          <WeekdayChart weekdays={report.weekdays} />
        </ChartCard>
        <ChartCard title="Most late arrivals">
          <LeaderChart
            employees={report.employees}
            value={(e) => e.late}
            color={STATUS_COLOR.late}
            label="Late arrivals"
          />
        </ChartCard>
        <ChartCard title="Most time past shift" sub="Hours worked after scheduled end">
          <LeaderChart
            employees={report.employees}
            value={(e) => Math.round(e.overtime_minutes / 6) / 10}
            unit="h"
            color={STATUS_COLOR.overtime}
            label="Past shift"
          />
        </ChartCard>
        <ChartCard title="Most minutes late" sub="Total across the range">
          <LeaderChart
            employees={report.employees}
            value={(e) => e.late_minutes}
            unit=" min"
            color="#ea580c"
            label="Minutes late"
          />
        </ChartCard>
        <ChartCard title="Most absences">
          <LeaderChart
            employees={report.employees}
            value={(e) => e.absent}
            color={STATUS_COLOR.absent}
            label="Absences"
          />
        </ChartCard>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">By employee</h2>
          <ExportMenu
            filename={`attendance-by-employee-${report.from}-to-${report.to}`}
            rows={employees}
            columns={[
              { key: "name", label: "Name", get: (e) => e.name },
              { key: "office", label: "Office", get: (e) => e.office },
              { key: "days", label: "Days worked", get: (e) => e.scheduled_days },
              { key: "rate", label: "On-time %", get: onTimeRate },
              { key: "late", label: "Late", get: (e) => e.late },
              { key: "late_min", label: "Minutes late", get: (e) => e.late_minutes },
              { key: "absent", label: "Absent", get: (e) => e.absent },
              { key: "time_off", label: "Time off days", get: (e) => e.time_off },
              { key: "early", label: "Left early", get: (e) => e.early_leaves },
              { key: "ot", label: "Hours past shift", get: (e) => hours(e.overtime_minutes) },
              { key: "weekly", label: "Overtime hours (40h+)", get: (e) => hours(e.weekly_overtime_minutes) },
              { key: "missed", label: "Missed clock-outs", get: (e) => e.missed_clockouts },
            ]}
          />
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader columnKey="name" label="Name" sort={sort} onToggle={toggle} />
                <SortHeader columnKey="days" label="Days" sort={sort} onToggle={toggle} align="right" />
                <SortHeader columnKey="rate" label="On time" sort={sort} onToggle={toggle} align="right" />
                <SortHeader columnKey="late" label="Late" sort={sort} onToggle={toggle} align="right" />
                <SortHeader columnKey="avg" label="Avg late" sort={sort} onToggle={toggle} align="right" />
                <SortHeader columnKey="absent" label="Absent" sort={sort} onToggle={toggle} align="right" />
                <SortHeader columnKey="early" label="Left early" sort={sort} onToggle={toggle} align="right" />
                <SortHeader columnKey="overtime" label="Past shift" sort={sort} onToggle={toggle} align="right" />
                <SortHeader columnKey="weekly" label="40h+ OT" sort={sort} onToggle={toggle} align="right" />
                <SortHeader columnKey="missed" label="No clock-out" sort={sort} onToggle={toggle} align="right" />
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                    Nobody in this scope.
                  </TableCell>
                </TableRow>
              )}
              {employees.map((e) => {
                const rate = onTimeRate(e);
                return (
                  <TableRow
                    key={e.profile_id}
                    className={cn("cursor-pointer", person === e.profile_id && "bg-accent")}
                    onClick={() => {
                      setPerson(person === e.profile_id ? null : e.profile_id);
                      setShown(PAGE);
                    }}
                  >
                    <TableCell className="font-medium">{e.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{e.scheduled_days}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rate === null ? "—" : (
                        <span className={rate < 80 ? "font-semibold text-destructive" : ""}>{rate}%</span>
                      )}
                    </TableCell>
                    <Num n={e.late} color={STATUS_COLOR.late} />
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {e.late ? mins(Math.round(e.late_minutes / e.late)) : "—"}
                    </TableCell>
                    <Num n={e.absent} color={STATUS_COLOR.absent} />
                    <Num n={e.early_leaves} color={KIND.early_leave.color} />
                    <TableCell className="text-right tabular-nums">
                      {e.overtime_minutes ? `${hours(e.overtime_minutes)}h` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.weekly_overtime_minutes ? `${hours(e.weekly_overtime_minutes)}h` : "—"}
                    </TableCell>
                    <Num n={e.missed_clockouts} color={KIND.missed_clockout.color} />
                    <TableCell className="text-right">
                      <Link
                        href={`/management/timesheets/${e.profile_id}`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="text-sm text-primary hover:underline"
                      >
                        Timesheet
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Click a row to filter the log below to that person.
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            Log
            {personName && (
              <button
                type="button"
                onClick={() => setPerson(null)}
                className="ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 align-middle text-xs font-normal hover:bg-accent"
              >
                {personName} ✕
              </button>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <Input
              value={q}
              onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
              placeholder="Search name or reason"
              className="h-8 w-56"
            />
            <ExportMenu
              filename={`attendance-log-${report.from}-to-${report.to}`}
              rows={events}
              columns={[
                { key: "date", label: "Date", get: (e) => e.date },
                { key: "name", label: "Employee", get: (e) => e.name },
                { key: "kind", label: "Event", get: (e) => KIND[e.kind].label },
                { key: "minutes", label: "Minutes", get: (e) => e.minutes || null },
                { key: "detail", label: "Detail", get: eventDetail },
                { key: "reason", label: "Late reason", get: (e) => e.reason },
              ]}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {KIND_ORDER.map((k) => {
            const on = !hidden.has(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => toggleKind(k)}
                aria-pressed={on}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  on ? "bg-card" : "opacity-50 hover:opacity-80",
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: KIND[k].color }} />
                {KIND[k].label}
                <span className="tabular-nums text-muted-foreground">{kindCounts[k]}</span>
              </button>
            );
          })}
        </div>

        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Date</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead className="w-36">Event</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Nothing to show.
                  </TableCell>
                </TableRow>
              )}
              {events.slice(0, shown).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {e.kind === "weekly_overtime" ? `Week of ${fmtDay(e.date)}` : fmtDay(e.date)}
                  </TableCell>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2 text-sm">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND[e.kind].color }} />
                      {KIND[e.kind].label}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{eventDetail(e)}</TableCell>
                  <TableCell className="max-w-xs text-sm">
                    {e.kind === "late" ? (
                      e.reason ? <span className="italic">&ldquo;{e.reason}&rdquo;</span> : (
                        <span className="text-muted-foreground">No reason given</span>
                      )
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {events.length > shown && (
          <div className="text-center">
            <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({events.length - shown} left)
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

// One count in the Today bar: hover lists the people, click opens today's
// full breakdown.
function TodayStat({
  color,
  n,
  label,
  people,
  onClick,
  className,
  popupClassName,
}: {
  color?: string;
  n: number;
  label: string;
  people: { profile_id: string; name: string; note?: string }[];
  onClick: () => void;
  className?: string;
  popupClassName?: string;
}) {
  const MAX = 12;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("group relative -mx-1 inline-flex items-center gap-1.5 rounded px-1 hover:bg-muted", className)}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      <span className="font-semibold tabular-nums">{n}</span>
      <span className="text-muted-foreground">{label}</span>
      {people.length > 0 && (
        <span
          className={cn(
            "pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-72 rounded-lg border bg-popover p-2.5 text-left text-xs text-popover-foreground shadow-md group-hover:block",
            popupClassName,
          )}
        >
          {people.slice(0, MAX).map((p) => (
            <span key={p.profile_id} className="flex justify-between gap-3">
              <span className="truncate">{p.name}</span>
              {p.note && <span className="shrink-0 text-muted-foreground">{p.note}</span>}
            </span>
          ))}
          {people.length > MAX && <span className="block text-muted-foreground">+{people.length - MAX} more</span>}
          <span className="mt-1.5 block text-[11px] text-muted-foreground">Click for today&apos;s full breakdown</span>
        </span>
      )}
    </button>
  );
}

function Num({ n, color }: { n: number; color: string }) {
  return (
    <TableCell className="text-right tabular-nums">
      {n ? <span className="font-semibold" style={{ color }}>{n}</span> : <span className="text-muted-foreground">—</span>}
    </TableCell>
  );
}
