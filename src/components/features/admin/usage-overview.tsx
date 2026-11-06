"use client";

import { Clock, Footprints, LogIn, Timer, Users, CalendarClock } from "lucide-react";
import type { AnalyticsData, UsageReport } from "@/lib/analytics/server";
import { BarList, DailyBars, HourHeatmap, fmtMinutes } from "./usage-charts";

// The top of App Analytics: headline numbers, daily trends, busiest times and
// where the time goes. Time and visits come from the apps' heartbeat
// (UsageReport); opens are launcher clicks.

const etDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** Every day from the range start (or the first day with data) to today, zero-filled. */
function fillDays(daily: UsageReport["daily"], since: string | null) {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const start = since ? etDay(new Date(since)) : daily[0]?.day;
  if (!start) return [];
  const end = etDay(new Date());
  const out: UsageReport["daily"] = [];
  for (let t = Date.parse(`${start}T12:00:00Z`); ; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (day > end) break;
    out.push(byDay.get(day) ?? { day, minutes: 0, people: 0, visits: 0, opens: 0 });
  }
  return out;
}

export function UsageOverview({
  data,
  people,
  loading,
}: {
  data: AnalyticsData | null;
  /** Everyone active in the range (used an app or opened one from the launcher). */
  people: number;
  loading: boolean;
}) {
  const usage = data?.usage ?? null;
  const t = usage?.totals;
  const dash = loading ? "…" : "—";
  const avgVisit = t && t.visits ? fmtMinutes(t.visit_minutes / t.visits) : dash;
  const perDay = t && t.person_days ? fmtMinutes(t.minutes / t.person_days) : dash;
  const days = usage && data ? fillDays(usage.daily, data.since) : [];
  // Visits and time of day only exist from the day migration 063 ran.
  const partial = usage?.tracked_since && (!data?.since || Date.parse(usage.tracked_since) > Date.parse(data.since));
  const trackedNote = usage?.tracked_since
    ? partial
      ? `Counted since ${new Date(usage.tracked_since).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`
      : undefined
    : "Starts filling in as people use the apps.";
  const range = data?.range ?? "30d";

  return (
    <div className="space-y-3">
      {data && !usage && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          Time in apps, visits and busiest times need database migration 063 — run
          supabase/migrations/063_usage_hourly.sql in the Supabase SQL Editor.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={Users} label="Active people" value={loading ? "…" : people.toLocaleString()} />
        <Kpi icon={Clock} label="Time in apps" value={t ? fmtMinutes(t.minutes) : dash} />
        <Kpi icon={Footprints} label="Visits" value={t ? t.visits.toLocaleString() : dash} sub={trackedNote} />
        <Kpi icon={Timer} label="Average visit" value={avgVisit} sub="Comes back after 30+ min away = new visit" />
        <Kpi icon={CalendarClock} label="A day, per person" value={perDay} sub="Time in apps on days they used them" />
        <Kpi
          icon={LogIn}
          label="Launcher opens"
          value={loading ? "…" : (data?.totals.launches ?? 0).toLocaleString()}
          sub={data ? `${data.totals.app_launches.toLocaleString()} apps · ${data.totals.link_clicks.toLocaleString()} links` : undefined}
        />
      </div>

      {usage && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DailyBars
              title="Active people"
              data={days.map((d) => ({ day: d.day, value: d.people }))}
              total={`Busiest day: ${Math.max(0, ...days.map((d) => d.people))}`}
            />
            <DailyBars title="Time in apps" data={days.map((d) => ({ day: d.day, value: d.minutes }))} fmt={fmtMinutes} />
            <DailyBars title="Visits" data={days.map((d) => ({ day: d.day, value: d.visits }))} />
            <DailyBars title="Launcher opens" data={days.map((d) => ({ day: d.day, value: d.opens }))} />
          </div>

          <HourHeatmap
            cells={usage.hours}
            initial={t && t.visit_minutes > 0 ? "minutes" : "opens"}
            metrics={[
              { key: "minutes", label: "Time in apps", unit: "in apps", fmt: fmtMinutes, note: trackedNote },
              { key: "visits", label: "Visits", unit: "visits", note: trackedNote },
              { key: "opens", label: "Launcher opens", unit: "opens" },
            ]}
          />

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Time by app" note="Active time in each app (a visible tab, used in the last 5 minutes).">
              <BarList
                fmt={fmtMinutes}
                rows={usage.apps.map((a) => ({
                  key: a.app_id,
                  label: a.name,
                  href: `/admin/analytics/apps/${a.app_id}?range=${range}`,
                  n: a.minutes,
                  sub: `${a.people} ${a.people === 1 ? "person" : "people"}${a.visits ? ` · ${a.visits.toLocaleString()} visits` : ""}`,
                }))}
              />
            </Panel>
            <Panel title="Most time in apps" note="Who spends the most time, and where.">
              <BarList
                fmt={fmtMinutes}
                rows={usage.users.slice(0, 25).map((u) => ({
                  key: u.profile_id,
                  label: u.name || u.email,
                  href: `/admin/analytics/users/${u.profile_id}?range=${range}`,
                  n: u.minutes,
                  sub: [u.top_app, u.visits ? `${u.visits} visits` : null].filter(Boolean).join(" · "),
                }))}
              />
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub }: { icon: typeof Users; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 truncate text-2xl font-semibold tabular-nums" title={value}>
        {value}
      </div>
      {sub && <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="border-b bg-muted/40 px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
