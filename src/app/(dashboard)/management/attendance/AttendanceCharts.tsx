"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import type {
  AttendanceDay,
  AttendanceDayPerson,
  AttendanceReport,
  EmployeeAttendance,
} from "@/lib/timesheets/attendance";
import { fmtTime } from "@/components/shared/format";
import { formatClockTime } from "@/lib/timesheets/schedule";

// Fixed status colours (readable on light and dark): the same status is
// always the same colour on every chart and badge.
export const STATUS_COLOR = {
  on_time: "#16a34a",
  late: "#f59e0b",
  absent: "#dc2626",
  not_in: "#dc2626",
  time_off: "#3b82f6",
  overtime: "#8b5cf6",
} as const;

const AXIS = { fontSize: 12, fill: "var(--muted-foreground)" };
const TOOLTIP = {
  contentStyle: {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--popover-foreground)",
    fontSize: 12,
  },
  cursor: { fill: "var(--muted)", opacity: 0.5 },
};

export function ChartCard({
  title,
  sub,
  className,
  children,
}: {
  title: string;
  sub?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border bg-card p-4 ${className ?? ""}`}>
      <div className="mb-3">
        <div className="text-sm font-semibold">{title}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function Empty() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      No data in this range
    </div>
  );
}

export function ArrivalsDonut({ totals }: {
  totals: { on_time: number; late: number; absent: number; time_off: number };
}) {
  const data = [
    { name: "On time", value: totals.on_time, color: STATUS_COLOR.on_time },
    { name: "Late", value: totals.late, color: STATUS_COLOR.late },
    { name: "Absent", value: totals.absent, color: STATUS_COLOR.absent },
    { name: "Time off", value: totals.time_off, color: STATUS_COLOR.time_off },
  ].filter((d) => d.value > 0);
  const worked = totals.on_time + totals.late;
  const rate = worked ? Math.round((totals.on_time / worked) * 100) : null;
  return (
    <div className="relative h-64">
      {data.length === 0 ? (
        <Empty />
      ) : (
        <>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius="58%"
                outerRadius="85%"
                paddingAngle={2}
                stroke="none"
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
              <Tooltip {...TOOLTIP} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
          {rate !== null && (
            <div className="pointer-events-none absolute inset-x-0 top-[calc(50%-1.75rem)] text-center">
              <div className="text-2xl font-bold tabular-nums">{rate}%</div>
              <div className="text-[11px] text-muted-foreground">on time</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const DAY_GROUPS: { status: AttendanceDayPerson["status"]; label: string }[] = [
  { status: "late", label: "Late" },
  { status: "not_in", label: "Not in yet" },
  { status: "absent", label: "Didn't clock in" },
  { status: "time_off", label: "Time off" },
  { status: "on_time", label: "On time / early" },
];

const BAR_STACK = [
  { status: "on_time", name: "On time" },
  { status: "late", name: "Late" },
  { status: "absent", name: "Absent" },
  { status: "time_off", name: "Time off" },
] as const;

export function arrivalNote(p: AttendanceDayPerson): string {
  if (p.status === "not_in") return p.scheduled ? `shift started ${formatClockTime(p.scheduled)}` : "";
  if (p.status === "absent") return p.scheduled ? `due ${formatClockTime(p.scheduled)}` : "";
  if (p.status === "time_off") return "full day";
  const time = p.at ? fmtTime(p.at) : "";
  if (p.status === "late") return `${time} · ${p.minutes} min late`;
  if (p.partial_off) return `${time} · partial day off`;
  return p.minutes <= -1 ? `${time} · ${-p.minutes} min early` : `${time} · on time`;
}

const dayLabel = (date: string, long = false) =>
  new Date(date + "T00:00:00").toLocaleDateString(
    [],
    long ? { weekday: "long", month: "short", day: "numeric" } : { month: "short", day: "numeric" },
  );

// Hover: who was late or missing. Click: the full list for that day.
function DayTooltip({ active, payload }: { active?: boolean; payload?: { payload?: AttendanceDay }[] }) {
  const day = payload?.[0]?.payload;
  if (!active || !day) return null;
  const MAX = 6;
  return (
    <div
      className="max-w-72 rounded-lg border p-2.5 text-xs shadow-md"
      style={{ background: "var(--popover)", color: "var(--popover-foreground)" }}
    >
      <div className="mb-1.5 font-semibold">{dayLabel(day.date, true)}</div>
      {DAY_GROUPS.map(({ status, label }) => {
        const people = day.people.filter((p) => p.status === status);
        if (!people.length) return null;
        const named = status === "late" || status === "absent" || status === "not_in";
        return (
          <div key={status} className="mb-1">
            <div className="flex items-center gap-1.5 font-medium">
              <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
              {label} · {people.length}
            </div>
            {named && (
              <div className="pl-3.5 text-muted-foreground">
                {people.slice(0, MAX).map((p) => (
                  <div key={p.profile_id} className="truncate">
                    {p.name}
                    {status === "late" ? ` (${p.minutes}m)` : ""}
                  </div>
                ))}
                {people.length > MAX && <div>+{people.length - MAX} more</div>}
              </div>
            )}
          </div>
        );
      })}
      <div className="mt-1.5 text-[11px] text-muted-foreground">Click for everyone</div>
    </div>
  );
}

export function DayBreakdown({ day, onClose }: { day: AttendanceDay; onClose: () => void }) {
  // "Not in yet" only exists for today; skip the empty column otherwise.
  const groups = DAY_GROUPS.filter((g) => g.status !== "not_in" || day.people.some((p) => p.status === "not_in"));
  return (
    <div className="mt-3 rounded-md border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          {dayLabel(day.date, true)}
          <span className="ml-2 font-normal text-muted-foreground">{day.people.length} scheduled</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close day breakdown"
        >
          <X className="size-4" />
        </button>
      </div>
      {day.people.length === 0 ? (
        <div className="text-sm text-muted-foreground">Nobody was scheduled.</div>
      ) : (
        <div className={`grid gap-3 sm:grid-cols-2 ${groups.length > 4 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
          {groups.map(({ status, label }) => {
            const people = day.people.filter((p) => p.status === status);
            return (
              <div key={status} className="min-w-0">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                  <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
                  {label}
                  <span className="text-muted-foreground">{people.length}</span>
                </div>
                {people.length === 0 ? (
                  <div className="text-xs text-muted-foreground">None</div>
                ) : (
                  <ul className="space-y-1">
                    {people.map((p) => (
                      <li key={p.profile_id} className="text-xs">
                        <Link
                          href={`/management/timesheets/${p.profile_id}`}
                          className="block truncate font-medium hover:underline"
                        >
                          {p.name}
                        </Link>
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
      )}
    </div>
  );
}

export function DailyArrivalsChart({ daily }: { daily: AttendanceReport["daily"] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const data = daily.map((d) => ({ ...d, label: dayLabel(d.date) }));
  const any = daily.some((d) => d.on_time + d.late + d.absent + d.time_off > 0);
  const day = daily.find((d) => d.date === selected);
  return (
    <>
      <div className="h-64">
        {!any ? (
          <Empty />
        ) : (
          <ResponsiveContainer>
            <BarChart
              data={data}
              margin={{ left: -20, right: 8 }}
              className="cursor-pointer"
              onClick={(state) => {
                const d = data[Number(state?.activeTooltipIndex)];
                if (d) setSelected((cur) => (cur === d.date ? null : d.date));
              }}
            >
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={12} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<DayTooltip />} cursor={TOOLTIP.cursor} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              {BAR_STACK.map(({ status, name }, i, all) => (
                <Bar
                  key={status}
                  dataKey={status}
                  name={name}
                  stackId="a"
                  fill={STATUS_COLOR[status]}
                  radius={i === all.length - 1 ? [3, 3, 0, 0] : undefined}
                >
                  {data.map((d) => (
                    <Cell key={d.date} opacity={selected && selected !== d.date ? 0.4 : 1} />
                  ))}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      {day && <DayBreakdown day={day} onClose={() => setSelected(null)} />}
    </>
  );
}

export function ArrivalTimesChart({ arrivals }: { arrivals: AttendanceReport["arrivals"] }) {
  const any = arrivals.some((a) => a.count > 0);
  return (
    <div className="h-64">
      {!any ? (
        <Empty />
      ) : (
        <ResponsiveContainer>
          <BarChart data={arrivals} margin={{ left: -20, right: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ ...AXIS, fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...TOOLTIP} />
            <Bar dataKey="count" name="Clock-ins" radius={[3, 3, 0, 0]}>
              {arrivals.map((a) => (
                <Cell key={a.label} fill={a.late ? STATUS_COLOR.late : STATUS_COLOR.on_time} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function WeekdayChart({ weekdays }: { weekdays: AttendanceReport["weekdays"] }) {
  const data = weekdays.map((w) => ({
    ...w,
    rate: w.on_time + w.late ? Math.round((w.late / (w.on_time + w.late)) * 100) : 0,
  }));
  return (
    <div className="h-64">
      {data.length === 0 ? (
        <Empty />
      ) : (
        <ResponsiveContainer>
          <BarChart data={data} margin={{ left: -20, right: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
            <Tooltip {...TOOLTIP} formatter={(v) => [`${v}%`, "Late"]} />
            <Bar dataKey="rate" name="Late" fill={STATUS_COLOR.late} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// Top-N employees by one numeric measure, as horizontal bars.
export function LeaderChart({
  employees,
  value,
  unit,
  color,
  label,
}: {
  employees: EmployeeAttendance[];
  value: (e: EmployeeAttendance) => number;
  unit?: string;
  color: string;
  label: string;
}) {
  const data = employees
    .map((e) => ({ name: e.name, value: value(e) }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  return (
    <div className="h-64">
      {data.length === 0 ? (
        <Empty />
      ) : (
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} stroke="var(--border)" />
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} unit={unit} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ ...AXIS, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={110}
            />
            <Tooltip {...TOOLTIP} formatter={(v) => [`${v}${unit ?? ""}`, label]} />
            <Bar dataKey="value" name={label} fill={color} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
