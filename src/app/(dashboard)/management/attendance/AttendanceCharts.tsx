"use client";

// Every chart here is a way in: hovering shows who's behind a number and
// clicking hands the caller something to zoom into (a day, a person, a
// bucket of arrivals). The zoomed views live in AttendanceDrill.tsx.

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
import { useMemo, useState } from "react";
import type {
  AttendanceDay,
  AttendanceDayPerson,
  AttendanceReport,
  EmployeeAttendance,
} from "@/lib/timesheets/attendance";
import { fmtTime } from "@/components/shared/format";
import { formatClockTime } from "@/lib/timesheets/schedule";
import { cn } from "@/lib/utils";

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

function TipBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="max-w-72 rounded-lg border p-2.5 text-xs shadow-md"
      style={{ background: "var(--popover)", color: "var(--popover-foreground)" }}
    >
      {children}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />;
}

// A short "who" list for tooltips: the most frequent names first.
function topNames(people: { profile_id: string; name: string }[], max = 6) {
  const c = new Map<string, { name: string; n: number }>();
  for (const p of people) {
    const cur = c.get(p.profile_id) ?? { name: p.name, n: 0 };
    cur.n++;
    c.set(p.profile_id, cur);
  }
  const all = [...c.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}

function WhoList({ people, counts }: { people: { profile_id: string; name: string }[]; counts?: boolean }) {
  const { shown, more } = topNames(people);
  return (
    <div className="pl-3.5 text-muted-foreground">
      {shown.map((p) => (
        <div key={p.name} className="truncate">
          {p.name}
          {counts && p.n > 1 ? ` ×${p.n}` : ""}
        </div>
      ))}
      {more > 0 && <div>+{more} more</div>}
    </div>
  );
}

export const DAY_GROUPS: { status: AttendanceDayPerson["status"]; label: string }[] = [
  { status: "late", label: "Late" },
  { status: "not_in", label: "Not in yet" },
  { status: "absent", label: "Didn't clock in" },
  { status: "time_off", label: "Time off" },
  { status: "on_time", label: "On time / early" },
];

export function arrivalNote(p: AttendanceDayPerson): string {
  if (p.status === "not_in") return p.scheduled ? `shift started ${formatClockTime(p.scheduled)}` : "";
  if (p.status === "absent") return p.scheduled ? `due ${formatClockTime(p.scheduled)}` : "";
  if (p.status === "time_off") return "full day";
  const time = p.at ? fmtTime(p.at) : "";
  if (p.status === "late") return `${time} · ${p.minutes} min late`;
  if (p.partial_off) return `${time} · partial day off`;
  return p.minutes <= -1 ? `${time} · ${-p.minutes} min early` : `${time} · on time`;
}

export function ArrivalsDonut({
  totals,
  people,
  onSlice,
}: {
  totals: { on_time: number; late: number; absent: number; time_off: number };
  people: AttendanceDayPerson[];
  onSlice: (status: AttendanceDayPerson["status"]) => void;
}) {
  const data = (
    [
      { status: "on_time", name: "On time", value: totals.on_time },
      { status: "late", name: "Late", value: totals.late },
      { status: "absent", name: "Absent", value: totals.absent },
      { status: "time_off", name: "Time off", value: totals.time_off },
    ] as const
  ).filter((d) => d.value > 0);
  const worked = totals.on_time + totals.late;
  const rate = worked ? Math.round((totals.on_time / worked) * 100) : null;
  return (
    <div className="relative h-64">
      {data.length === 0 ? (
        <Empty />
      ) : (
        <>
          <ResponsiveContainer>
            <PieChart className="cursor-pointer">
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius="58%"
                outerRadius="85%"
                paddingAngle={2}
                stroke="none"
                onClick={(_, i) => onSlice(data[i].status)}
              >
                {data.map((d) => (
                  <Cell key={d.name} fill={STATUS_COLOR[d.status]} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  const d = payload?.[0]?.payload as (typeof data)[number] | undefined;
                  if (!active || !d) return null;
                  return (
                    <TipBox>
                      <div className="mb-1 flex items-center gap-1.5 font-semibold">
                        <Dot color={STATUS_COLOR[d.status]} />
                        {d.name} · {d.value} day{d.value === 1 ? "" : "s"}
                      </div>
                      {d.status !== "on_time" && (
                        <WhoList people={people.filter((p) => p.status === d.status)} counts />
                      )}
                      <div className="mt-1.5 text-[11px] text-muted-foreground">Click for every one</div>
                    </TipBox>
                  );
                }}
              />
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

const BAR_STACK = [
  { status: "on_time", name: "On time" },
  { status: "late", name: "Late" },
  { status: "absent", name: "Absent" },
  { status: "time_off", name: "Time off" },
] as const;

const dayLabel = (date: string, long = false) =>
  new Date(date + "T00:00:00").toLocaleDateString(
    [],
    long ? { weekday: "long", month: "short", day: "numeric" } : { month: "short", day: "numeric" },
  );

// Sunday on or before a YYYY-MM-DD day.
function weekOf(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

type ChartRow = AttendanceDay & { label: string; week?: boolean };

function DayTooltip({ active, payload }: { active?: boolean; payload?: { payload?: ChartRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <TipBox>
      <div className="mb-1.5 font-semibold">{row.week ? `Week of ${dayLabel(row.date)}` : dayLabel(row.date, true)}</div>
      {DAY_GROUPS.map(({ status, label }) => {
        const people = row.people.filter((p) => p.status === status);
        if (!people.length) return null;
        return (
          <div key={status} className="mb-1">
            <div className="flex items-center gap-1.5 font-medium">
              <Dot color={STATUS_COLOR[status]} />
              {label} · {people.length}
            </div>
            {status !== "on_time" && status !== "time_off" && <WhoList people={people} counts={row.week} />}
          </div>
        );
      })}
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        {row.week ? "Click to zoom into this week" : "Click for everyone"}
      </div>
    </TipBox>
  );
}

// Day bars, or week bars for long ranges. Clicking a week zooms the chart
// into its days; clicking a day hands it to onDay.
export function DailyArrivalsChart({
  daily,
  onDay,
}: {
  daily: AttendanceReport["daily"];
  onDay: (date: string) => void;
}) {
  const [byWeek, setByWeek] = useState(daily.length > 31);
  const [zoomWeek, setZoomWeek] = useState<string | null>(null);

  const data: ChartRow[] = useMemo(() => {
    if (zoomWeek) {
      return daily.filter((d) => weekOf(d.date) === zoomWeek).map((d) => ({ ...d, label: dayLabel(d.date) }));
    }
    if (!byWeek) return daily.map((d) => ({ ...d, label: dayLabel(d.date) }));
    const weeks = new Map<string, ChartRow>();
    for (const d of daily) {
      const k = weekOf(d.date);
      const w = weeks.get(k) ?? {
        date: k, label: dayLabel(k), week: true, on_time: 0, late: 0, absent: 0, time_off: 0, people: [],
      };
      w.on_time += d.on_time;
      w.late += d.late;
      w.absent += d.absent;
      w.time_off += d.time_off;
      w.people = w.people.concat(d.people);
      weeks.set(k, w);
    }
    return [...weeks.values()];
  }, [daily, byWeek, zoomWeek]);

  const any = daily.some((d) => d.on_time + d.late + d.absent + d.time_off > 0);
  return (
    <div>
      <div className="mb-2 flex h-6 justify-end gap-2 text-xs">
        {zoomWeek ? (
          <button type="button" onClick={() => setZoomWeek(null)} className="rounded border px-2 py-0.5 hover:bg-muted">
            ← All weeks
          </button>
        ) : (
          daily.length > 7 && (
            <div className="inline-flex rounded-md border p-0.5">
              {(["Days", "Weeks"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setByWeek(m === "Weeks")}
                  className={cn(
                    "rounded px-2 py-0.5",
                    byWeek === (m === "Weeks") ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          )
        )}
      </div>
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
                const row = data[Number(state?.activeTooltipIndex)];
                if (!row) return;
                if (row.week) setZoomWeek(row.date);
                else onDay(row.date);
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
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export function ArrivalTimesChart({
  arrivals,
  people,
  onBucket,
}: {
  arrivals: AttendanceReport["arrivals"];
  people: AttendanceDayPerson[];
  onBucket: (index: number) => void;
}) {
  const any = arrivals.some((a) => a.count > 0);
  return (
    <div className="h-64">
      {!any ? (
        <Empty />
      ) : (
        <ResponsiveContainer>
          <BarChart
            data={arrivals}
            margin={{ left: -20, right: 8 }}
            className="cursor-pointer"
            onClick={(state) => {
              const i = Number(state?.activeTooltipIndex);
              if (arrivals[i]?.count) onBucket(i);
            }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ ...AXIS, fontSize: 10 }} tickLine={false} axisLine={false} interval={0} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              cursor={TOOLTIP.cursor}
              content={({ active, payload }) => {
                const a = payload?.[0]?.payload as AttendanceReport["arrivals"][number] | undefined;
                if (!active || !a) return null;
                const i = arrivals.indexOf(a);
                return (
                  <TipBox>
                    <div className="mb-1 font-semibold">
                      {a.label} · {a.count} clock-in{a.count === 1 ? "" : "s"}
                    </div>
                    <WhoList people={people.filter((p) => p.bucket === i)} counts />
                    <div className="mt-1.5 text-[11px] text-muted-foreground">Click for every one</div>
                  </TipBox>
                );
              }}
            />
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

export function WeekdayChart({
  weekdays,
  onDay,
}: {
  weekdays: AttendanceReport["weekdays"];
  onDay: (weekday: string) => void;
}) {
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
          <BarChart
            data={data}
            margin={{ left: -20, right: 8 }}
            className="cursor-pointer"
            onClick={(state) => {
              const w = data[Number(state?.activeTooltipIndex)];
              if (w?.late) onDay(w.day);
            }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
            <Tooltip
              cursor={TOOLTIP.cursor}
              content={({ active, payload }) => {
                const w = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !w) return null;
                return (
                  <TipBox>
                    <div className="font-semibold">
                      {w.day}: {w.rate}% late
                    </div>
                    <div className="text-muted-foreground">
                      {w.late} late of {w.on_time + w.late} arrivals
                    </div>
                    {w.late > 0 && <div className="mt-1.5 text-[11px] text-muted-foreground">Click for who and when</div>}
                  </TipBox>
                );
              }}
            />
            <Bar dataKey="rate" name="Late" fill={STATUS_COLOR.late} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

const LEADER_TOP = 8;

// Employees ranked by one measure. Top 8 by default; "Show all" zooms out
// to everyone. Clicking a bar opens that person.
export function LeaderChart({
  employees,
  value,
  unit,
  color,
  label,
  detail,
  onPick,
}: {
  employees: EmployeeAttendance[];
  value: (e: EmployeeAttendance) => number;
  unit?: string;
  color: string;
  label: string;
  detail?: (e: EmployeeAttendance) => string;
  onPick: (profileId: string) => void;
}) {
  const [all, setAll] = useState(false);
  const ranked = employees
    .map((e) => ({ id: e.profile_id, name: e.name, value: value(e), emp: e }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const data = all ? ranked : ranked.slice(0, LEADER_TOP);
  return (
    <div>
      <div
        className="overflow-y-auto"
        style={{ height: all ? Math.min(Math.max(256, data.length * 28 + 40), 640) : 256 }}
      >
        {data.length === 0 ? (
          <Empty />
        ) : (
          <div style={{ height: Math.max(256, data.length * 28 + 40) }}>
            <ResponsiveContainer>
              <BarChart
                data={data}
                layout="vertical"
                margin={{ left: 8, right: 16 }}
                className="cursor-pointer"
                onClick={(state) => {
                  const d = data[Number(state?.activeTooltipIndex)];
                  if (d) onPick(d.id);
                }}
              >
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} unit={unit} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ ...AXIS, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={110}
                  interval={0}
                />
                <Tooltip
                  cursor={TOOLTIP.cursor}
                  content={({ active, payload }) => {
                    const d = payload?.[0]?.payload as (typeof data)[number] | undefined;
                    if (!active || !d) return null;
                    return (
                      <TipBox>
                        <div className="font-semibold">{d.name}</div>
                        <div>
                          {label}: {d.value}
                          {unit ?? ""}
                        </div>
                        {detail && <div className="text-muted-foreground">{detail(d.emp)}</div>}
                        <div className="mt-1.5 text-[11px] text-muted-foreground">Click for their days</div>
                      </TipBox>
                    );
                  }}
                />
                <Bar dataKey="value" name={label} fill={color} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      {ranked.length > LEADER_TOP && (
        <button
          type="button"
          onClick={() => setAll((a) => !a)}
          className="mt-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {all ? `Top ${LEADER_TOP} only` : `Show all ${ranked.length}`}
        </button>
      )}
    </div>
  );
}
