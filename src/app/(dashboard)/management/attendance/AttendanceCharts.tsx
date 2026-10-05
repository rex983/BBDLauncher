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
import type { AttendanceReport, EmployeeAttendance } from "@/lib/timesheets/attendance";

// Fixed status colours (readable on light and dark): the same status is
// always the same colour on every chart and badge.
export const STATUS_COLOR = {
  on_time: "#16a34a",
  late: "#f59e0b",
  absent: "#dc2626",
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

export function DailyArrivalsChart({ daily }: { daily: AttendanceReport["daily"] }) {
  const data = daily.map((d) => ({
    ...d,
    label: new Date(d.date + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" }),
  }));
  const any = daily.some((d) => d.on_time + d.late + d.absent + d.time_off > 0);
  return (
    <div className="h-64">
      {!any ? (
        <Empty />
      ) : (
        <ResponsiveContainer>
          <BarChart data={data} margin={{ left: -20, right: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={12} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...TOOLTIP} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="on_time" name="On time" stackId="a" fill={STATUS_COLOR.on_time} />
            <Bar dataKey="late" name="Late" stackId="a" fill={STATUS_COLOR.late} />
            <Bar dataKey="absent" name="Absent" stackId="a" fill={STATUS_COLOR.absent} />
            <Bar dataKey="time_off" name="Time off" stackId="a" fill={STATUS_COLOR.time_off} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
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
