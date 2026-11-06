"use client";

import Link from "next/link";
import { useState } from "react";

// Analytics overview charts (same look as the manufacturer hub's): one measure
// per day as bars, a day × hour heat map, and ranked bar lists.

const HEAT = "oklch(0.55 0.19 255)";

/** "2h 05m", "45m", "0m". */
export function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return h ? `${h}h ${String(mm).padStart(2, "0")}m` : `${mm}m`;
}

function fmtDayKey(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** One measure per day as thin bars on its own scale, with a hover readout. */
export function DailyBars({
  title,
  data,
  fmt = (v) => v.toLocaleString(),
  total,
}: {
  title: string;
  data: { day: string; value: number }[];
  fmt?: (v: number) => string;
  /** What the corner shows when nothing is hovered (default: the sum, "N total"). */
  total?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 300;
  const H = 72;
  const gap = data.length > 60 ? 1 : 2;
  const bw = Math.max(1, (W - gap * (data.length - 1)) / Math.max(1, data.length));
  const shown = hover != null ? data[hover] : null;
  return (
    <figure className="rounded-xl border bg-card p-3">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {shown ? (
            <>
              {fmtDayKey(shown.day)}: <span className="font-semibold text-foreground">{fmt(shown.value)}</span>
            </>
          ) : total != null ? (
            total
          ) : (
            <>
              <span className="font-semibold text-foreground">{fmt(data.reduce((n, d) => n + d.value, 0))}</span> total
            </>
          )}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2 h-20 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${title} per day`}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-border" strokeWidth={1} />
        {data.map((d, i) => {
          const h = d.value ? Math.max(2, (d.value / max) * (H - 4)) : 0;
          const x = i * (bw + gap);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              {/* Hit target is the full column, bigger than the bar. */}
              <rect x={x} y={0} width={bw + gap} height={H} fill="transparent" />
              <rect x={x} y={H - h} width={bw} height={h} rx={Math.min(2, bw / 2)} fill={HEAT} opacity={hover === i ? 1 : 0.6} />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0] ? fmtDayKey(data[0].day) : ""}</span>
        <span>{data.length ? fmtDayKey(data[data.length - 1]!.day) : ""}</span>
      </div>
    </figure>
  );
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type HeatMetric = { key: string; label: string; unit: string; fmt?: (v: number) => string; note?: string };

/**
 * Day-of-week × hour-of-day (Eastern), one hue light → dark, with a switch
 * between measures. `cells` carry every measure's value by key.
 */
export function HourHeatmap({
  cells,
  metrics,
  initial,
}: {
  cells: ({ dow: number; hour: number } & Record<string, number>)[];
  metrics: HeatMetric[];
  initial?: string;
}) {
  const [metric, setMetric] = useState(initial ?? metrics[0]!.key);
  const [hover, setHover] = useState<{ dow: number; hour: number; n: number } | null>(null);
  const m = metrics.find((x) => x.key === metric) ?? metrics[0]!;
  const fmt = m.fmt ?? ((v: number) => v.toLocaleString());
  const grid = new Map(cells.map((c) => [`${c.dow}|${c.hour}`, c[m.key] ?? 0]));
  const max = Math.max(1, ...grid.values());
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Busiest times (Eastern)</span>
          <span className="flex gap-1 print:hidden">
            {metrics.map((x) => (
              <button
                key={x.key}
                type="button"
                onClick={() => setMetric(x.key)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                  x.key === m.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {x.label}
              </button>
            ))}
          </span>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {hover ? (
            <>
              {DOW[hover.dow - 1]} {hourLabel(hover.hour)}: <span className="font-semibold text-foreground">{fmt(hover.n)}</span> {m.unit}
            </>
          ) : (
            "Hover a cell"
          )}
        </span>
      </div>
      {m.note && <p className="mt-1 text-[11px] text-muted-foreground">{m.note}</p>}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-separate" style={{ borderSpacing: 2 }} onMouseLeave={() => setHover(null)}>
          <tbody>
            {DOW.map((d, i) => (
              <tr key={d}>
                <th scope="row" className="pr-1 text-left text-[10px] font-normal text-muted-foreground">
                  {d}
                </th>
                {hours.map((h) => {
                  const n = grid.get(`${i + 1}|${h}`) ?? 0;
                  return (
                    <td
                      key={h}
                      onMouseEnter={() => setHover({ dow: i + 1, hour: h, n })}
                      className="h-5 min-w-[10px] rounded-[3px] bg-muted"
                      style={n ? { backgroundColor: `color-mix(in oklab, ${HEAT} ${Math.round(15 + (n / max) * 85)}%, transparent)` } : undefined}
                      aria-label={`${d} ${hourLabel(h)}: ${fmt(n)} ${m.unit}`}
                    />
                  );
                })}
              </tr>
            ))}
            <tr>
              <td />
              {hours.map((h) => (
                <td key={h} className="text-center text-[9px] text-muted-foreground">
                  {h % 3 === 0 ? hourLabel(h) : ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function hourLabel(h: number): string {
  return h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;
}

/** Ranked rows with a bar behind each, scaled to the top one. */
export function BarList({
  rows,
  fmt = (v) => v.toLocaleString(),
  empty = "Nothing yet.",
}: {
  rows: { key: string; label: string; n: number; sub?: string; href?: string }[];
  fmt?: (v: number) => string;
  empty?: string;
}) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="max-h-96 space-y-1.5 overflow-y-auto">
      {rows.map((r) => (
        <li key={r.key} className="relative rounded-md px-2 py-1">
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-md"
            style={{ width: `${(r.n / max) * 100}%`, backgroundColor: `color-mix(in oklab, ${HEAT} 14%, transparent)` }}
          />
          <span className="relative flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              {r.href ? (
                <Link href={r.href} className="hover:underline">
                  {r.label}
                </Link>
              ) : (
                r.label
              )}
              {r.sub ? <span className="ml-2 text-xs text-muted-foreground">{r.sub}</span> : null}
            </span>
            <span className="shrink-0 font-medium tabular-nums">{fmt(r.n)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
