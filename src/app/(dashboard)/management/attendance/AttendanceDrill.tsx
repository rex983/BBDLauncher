"use client";

// The zoomable detail view behind every chart, card and name on the
// Attendance page. Each click pushes a view (a list, a day or a person) and
// Back pops it, so a manager can go overview → day → person → that
// person's day and back out again.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtDay, fmtTime } from "@/components/shared/format";
import { WEEKDAY_LABELS, formatClockTime } from "@/lib/timesheets/schedule";
import type {
  AttendanceDayPerson,
  AttendanceEvent,
  AttendanceEventKind,
  AttendanceReport,
} from "@/lib/timesheets/attendance";
import { DAY_GROUPS, STATUS_COLOR, arrivalNote } from "./AttendanceCharts";

export const KIND: Record<AttendanceEventKind, { label: string; color: string }> = {
  late: { label: "Late", color: STATUS_COLOR.late },
  absent: { label: "Absent", color: STATUS_COLOR.absent },
  early_leave: { label: "Left early", color: "#f97316" },
  overtime: { label: "Stayed late", color: STATUS_COLOR.overtime },
  weekly_overtime: { label: "Over 40h", color: "#6d28d9" },
  missed_clockout: { label: "No clock-out", color: "#64748b" },
  unscheduled: { label: "Day off worked", color: STATUS_COLOR.time_off },
};
export const KIND_ORDER = Object.keys(KIND) as AttendanceEventKind[];

export function mins(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function hours(m: number): string {
  return (m / 60).toFixed(1);
}

export function eventDetail(e: AttendanceEvent): string {
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

export interface DrillRow {
  key: string;
  date: string;
  profile_id: string;
  name: string;
  color: string;
  label: string;
  detail: string;
  reason?: string | null;
}

export type DrillView =
  | { type: "person"; id: string; focus?: AttendanceEventKind }
  | { type: "day"; date: string }
  | { type: "list"; title: string; sub?: string; rows: DrillRow[] };

const STATUS_LABEL = Object.fromEntries(DAY_GROUPS.map((g) => [g.status, g.label])) as Record<
  AttendanceDayPerson["status"],
  string
>;

// ---- Row builders for the openers -------------------------------------

function personRows(report: AttendanceReport, keep: (p: AttendanceDayPerson) => boolean): DrillRow[] {
  const rows: DrillRow[] = [];
  for (const d of [...report.daily].reverse()) {
    for (const p of d.people) {
      if (!keep(p)) continue;
      rows.push({
        key: `${d.date}:${p.profile_id}`,
        date: d.date,
        profile_id: p.profile_id,
        name: p.name,
        color: STATUS_COLOR[p.status],
        label: STATUS_LABEL[p.status],
        detail: arrivalNote(p),
        reason: p.reason,
      });
    }
  }
  return rows;
}

export function rowsForStatus(report: AttendanceReport, status: AttendanceDayPerson["status"]) {
  return personRows(report, (p) => p.status === status);
}

export function rowsForBucket(report: AttendanceReport, bucket: number) {
  return personRows(report, (p) => p.bucket === bucket);
}

export function rowsForWeekday(report: AttendanceReport, weekday: string) {
  const days = new Set(
    report.daily
      .filter((d) => WEEKDAY_LABELS[new Date(d.date + "T00:00:00Z").getUTCDay()] === weekday)
      .map((d) => d.date),
  );
  return personRows(report, (p) => p.status === "late").filter((r) => days.has(r.date));
}

export function rowsForKind(report: AttendanceReport, kind: AttendanceEventKind): DrillRow[] {
  return report.events
    .filter((e) => e.kind === kind)
    .map((e) => ({
      key: e.id,
      date: e.date,
      profile_id: e.profile_id,
      name: e.name,
      color: KIND[kind].color,
      label: KIND[kind].label,
      detail: eventDetail(e),
      reason: e.kind === "late" ? e.reason : null,
    }));
}

// ---- The dialog ---------------------------------------------------------

export function AttendanceDrill({
  report,
  stack,
  setStack,
}: {
  report: AttendanceReport;
  stack: DrillView[];
  setStack: (fn: (s: DrillView[]) => DrillView[]) => void;
}) {
  const view = stack.at(-1);
  const push = (v: DrillView) => setStack((s) => [...s, v]);
  const back = () => setStack((s) => s.slice(0, -1));
  const onPerson = (id: string) => push({ type: "person", id });
  const onDay = (date: string) => push({ type: "day", date });

  const nameOf = (id: string) =>
    report.employees.find((e) => e.profile_id === id)?.name ??
    report.daily.flatMap((d) => d.people).find((p) => p.profile_id === id)?.name ??
    report.events.find((e) => e.profile_id === id)?.name ??
    "Employee";

  let title = "";
  let sub: string | undefined;
  if (view?.type === "person") {
    title = nameOf(view.id);
    sub = `${fmtDay(report.from)} – ${fmtDay(report.to)}`;
  } else if (view?.type === "day") {
    title = new Date(view.date + "T00:00:00").toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  } else if (view) {
    title = view.title;
    sub = view.sub;
  }

  return (
    <Dialog open={!!view} onOpenChange={(o) => !o && setStack(() => [])}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {stack.length > 1 && (
              <button
                type="button"
                onClick={back}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Back"
              >
                <ArrowLeft className="size-4" />
              </button>
            )}
            <DialogTitle>{title}</DialogTitle>
          </div>
          {sub && <DialogDescription>{sub}</DialogDescription>}
          {stack.length > 1 && (
            <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
              {stack.slice(0, -1).map((v, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStack((s) => s.slice(0, i + 1))}
                  className="hover:text-foreground hover:underline"
                >
                  {v.type === "person" ? nameOf(v.id) : v.type === "day" ? fmtDay(v.date) : v.title} ›
                </button>
              ))}
            </div>
          )}
        </DialogHeader>
        {view?.type === "person" && (
          <PersonView key={view.id} report={report} id={view.id} focus={view.focus} onDay={onDay} />
        )}
        {view?.type === "day" && <DayView key={view.date} report={report} date={view.date} onPerson={onPerson} />}
        {view?.type === "list" && <ListView rows={view.rows} onPerson={onPerson} onDay={onDay} />}
      </DialogContent>
    </Dialog>
  );
}

function NameButton({ id, name, onPerson }: { id: string; name: string; onPerson: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onPerson(id)} className="truncate text-left font-medium hover:underline">
      {name}
    </button>
  );
}

function DateButton({ date, onDay, label }: { date: string; onDay: (d: string) => void; label?: string }) {
  return (
    <button type="button" onClick={() => onDay(date)} className="whitespace-nowrap text-left hover:underline">
      {label ?? fmtDay(date)}
    </button>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />;
}

function ListView({
  rows,
  onPerson,
  onDay,
}: {
  rows: DrillRow[];
  onPerson: (id: string) => void;
  onDay: (date: string) => void;
}) {
  // Who shows up most in this list, for a quick read before the detail.
  const top = useMemo(() => {
    const c = new Map<string, { id: string; name: string; n: number }>();
    for (const r of rows) {
      const cur = c.get(r.profile_id) ?? { id: r.profile_id, name: r.name, n: 0 };
      cur.n++;
      c.set(r.profile_id, cur);
    }
    return [...c.values()].sort((a, b) => b.n - a.n);
  }, [rows]);

  if (!rows.length) return <div className="text-sm text-muted-foreground">Nothing in this range.</div>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {top.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPerson(t.id)}
            className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted"
          >
            {t.name} <span className="tabular-nums text-muted-foreground">×{t.n}</span>
          </button>
        ))}
      </div>
      <RowTable rows={rows} onPerson={onPerson} onDay={onDay} />
    </div>
  );
}

function RowTable({
  rows,
  onPerson,
  onDay,
  showName = true,
}: {
  rows: DrillRow[];
  onPerson: (id: string) => void;
  onDay: (date: string) => void;
  showName?: boolean;
}) {
  return (
    <div className="divide-y rounded-md border text-sm">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-0.5 px-3 py-2 sm:grid-cols-[6.5rem_12rem_1fr]">
          <span className="text-muted-foreground">
            <DateButton date={r.date} onDay={onDay} />
          </span>
          {showName ? (
            <NameButton id={r.profile_id} name={r.name} onPerson={onPerson} />
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Dot color={r.color} />
              {r.label}
            </span>
          )}
          <span className="col-span-2 text-muted-foreground sm:col-span-1">
            {showName && (
              <span className="mr-1.5 inline-flex items-center gap-1.5 text-foreground">
                <Dot color={r.color} />
                {r.label} ·
              </span>
            )}
            {r.detail}
            {r.reason && <span className="italic"> · &ldquo;{r.reason}&rdquo;</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function DayView({
  report,
  date,
  onPerson,
}: {
  report: AttendanceReport;
  date: string;
  onPerson: (id: string) => void;
}) {
  const day = report.daily.find((d) => d.date === date);
  const people = day?.people ?? [];
  const groups = DAY_GROUPS.filter((g) => g.status !== "not_in" || people.some((p) => p.status === "not_in"));
  const other = report.events.filter(
    (e) => e.date === date && e.kind !== "late" && e.kind !== "absent" && e.kind !== "weekly_overtime",
  );
  if (!people.length && !other.length) {
    return <div className="text-sm text-muted-foreground">Nobody was scheduled.</div>;
  }
  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">{people.length} scheduled</div>
      <div className={cn("grid gap-4 sm:grid-cols-2", groups.length > 4 ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
        {groups.map(({ status, label }) => {
          const list = people.filter((p) => p.status === status);
          return (
            <div key={status} className="min-w-0">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                <Dot color={STATUS_COLOR[status]} />
                {label}
                <span className="text-muted-foreground">{list.length}</span>
              </div>
              {list.length === 0 ? (
                <div className="text-xs text-muted-foreground">None</div>
              ) : (
                <ul className="space-y-1">
                  {list.map((p) => (
                    <li key={p.profile_id} className="text-xs">
                      <NameButton id={p.profile_id} name={p.name} onPerson={onPerson} />
                      <div className="truncate text-muted-foreground" title={p.reason ?? undefined}>
                        {arrivalNote(p)}
                        {p.reason ? ` · “${p.reason}”` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {other.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold">Also that day</div>
          <div className="divide-y rounded-md border text-sm">
            {other.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5">
                <NameButton id={e.profile_id} name={e.name} onPerson={onPerson} />
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Dot color={KIND[e.kind].color} />
                  {KIND[e.kind].label} · {eventDetail(e)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PersonView({
  report,
  id,
  focus,
  onDay,
}: {
  report: AttendanceReport;
  id: string;
  focus?: AttendanceEventKind;
  onDay: (date: string) => void;
}) {
  const emp = report.employees.find((e) => e.profile_id === id);
  const [only, setOnly] = useState<AttendanceEventKind | null>(focus ?? null);
  const days = report.daily.map((d) => ({ date: d.date, p: d.people.find((x) => x.profile_id === id) }));
  const events = report.events.filter((e) => e.profile_id === id);
  const counts = KIND_ORDER.map((k) => ({ k, n: events.filter((e) => e.kind === k).length })).filter((c) => c.n);
  const shown = only ? events.filter((e) => e.kind === only) : events;
  const arrived = emp ? emp.on_time + emp.late : 0;
  const arrivals = days.filter((d) => d.p?.at && d.p.status !== "not_in");
  const avgIn = arrivals.length
    ? Math.round(arrivals.reduce((s, d) => s + d.p!.minutes, 0) / arrivals.length)
    : null;

  const stats: { label: string; value: string; color?: string }[] = emp
    ? [
        { label: "On time", value: arrived ? `${Math.round((emp.on_time / arrived) * 100)}%` : "—" },
        { label: "Late", value: String(emp.late), color: emp.late ? STATUS_COLOR.late : undefined },
        { label: "Avg late", value: emp.late ? mins(Math.round(emp.late_minutes / emp.late)) : "—" },
        { label: "Absent", value: String(emp.absent), color: emp.absent ? STATUS_COLOR.absent : undefined },
        { label: "Time off", value: `${emp.time_off}d` },
        { label: "Past shift", value: `${hours(emp.overtime_minutes)}h` },
        { label: "Worked", value: `${(emp.worked_ms / 3_600_000).toFixed(1)}h` },
        {
          label: "Typical clock-in",
          value: avgIn === null ? "—" : avgIn <= 0 ? `${-avgIn} min early` : `${avgIn} min late`,
        },
      ]
    : [];

  return (
    <div className="space-y-5">
      {emp && (
        <div className="text-sm text-muted-foreground">
          {[emp.office, emp.department].filter(Boolean).join(" · ")}
          {" · "}
          <Link href={`/management/timesheets/${id}`} className="text-primary hover:underline">
            Open timesheet
          </Link>
        </div>
      )}
      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-md border px-3 py-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
              <div className="font-semibold tabular-nums" style={s.color ? { color: s.color } : undefined}>
                {s.value}
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="mb-1.5 text-xs font-semibold">Every day in range</div>
        <div className="flex flex-wrap gap-1">
          {days.map(({ date, p }) => {
            const extra = events.filter((e) => e.date === date && e.kind !== "weekly_overtime");
            const title = [
              fmtDay(date),
              p ? `${STATUS_LABEL[p.status]} · ${arrivalNote(p)}` : "Not scheduled",
              ...extra.filter((e) => e.kind !== "late" && e.kind !== "absent").map((e) => KIND[e.kind].label),
            ].join("\n");
            return (
              <button
                key={date}
                type="button"
                title={title}
                onClick={() => onDay(date)}
                className={cn(
                  "relative size-6 rounded-sm border text-[9px] tabular-nums text-white/90 hover:ring-2 hover:ring-ring",
                  !p && "bg-muted text-muted-foreground",
                )}
                style={p ? { background: STATUS_COLOR[p.status], borderColor: "transparent" } : undefined}
              >
                {Number(date.slice(8))}
                {extra.some((e) => e.kind !== "late" && e.kind !== "absent") && (
                  <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-foreground" />
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          {(["on_time", "late", "absent", "time_off"] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <Dot color={STATUS_COLOR[s]} />
              {STATUS_LABEL[s]}
            </span>
          ))}
          <span>Dot = left early, stayed late or no clock-out · click a day to zoom in</span>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold">Events</span>
          <button
            type="button"
            onClick={() => setOnly(null)}
            className={cn("rounded-full border px-2.5 py-0.5 text-xs", !only ? "bg-muted font-medium" : "hover:bg-muted")}
          >
            All {events.length}
          </button>
          {counts.map(({ k, n }) => (
            <button
              key={k}
              type="button"
              onClick={() => setOnly(only === k ? null : k)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs",
                only === k ? "bg-muted font-medium" : "hover:bg-muted",
              )}
            >
              <Dot color={KIND[k].color} />
              {KIND[k].label} {n}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <div className="text-sm text-muted-foreground">No late arrivals, absences or overtime in this range.</div>
        ) : (
          <RowTable
            showName={false}
            onPerson={() => {}}
            onDay={onDay}
            rows={shown.map((e) => ({
              key: e.id,
              date: e.date,
              profile_id: e.profile_id,
              name: e.name,
              color: KIND[e.kind].color,
              label: KIND[e.kind].label,
              detail: eventDetail(e),
              reason: e.kind === "late" ? e.reason : null,
            }))}
          />
        )}
      </div>
    </div>
  );
}
