"use client";

import { useCallback, useEffect, useState } from "react";
import { Target, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// A rep's goals and track record, from Rep Insights (/api/my-goals). From the
// 1st to the 5th they set the month's goals here, once; after that only their
// manager or team lead changes them (in Rep Insights). Everyone who isn't a
// rep there sees nothing. <MyGoalsCard> is the profile's; <MyNumbersCompact>
// sits on the clock-in screen, so clocking in and out shows how the day,
// week and month are going against the same time last month.

type Metric = "sales" | "business" | "quotes" | "talk_hours";
interface Numbers {
  sales: number;
  business: number;
  quotes: number;
  talk_hours: number;
  leads: number;
  valuePerLead: number | null;
}
interface RepSelf {
  rep: true;
  today: string;
  month: string;
  goals: {
    metrics: { key: Metric; label: string; unit: string; step: number; target: number | null; from: "rep" | "office" | null }[];
    submittedAt: string | null;
    windowEnds: string;
    canSubmit: boolean;
  };
  periods: { key: "day" | "week" | "month"; label: string; start: string; end: string; wasStart: string; wasEnd: string; now: Numbers; was: Numbers; goal: Record<Metric, number | null> }[];
  ranks: { key: "month" | "ytd"; label: string; of: number; items: { key: "valuePerLead" | "sales" | "business"; label: string; value: number | null; rank: number | null }[] }[];
}
type State = { status: "loading" } | { status: "none" } | { status: "error"; error: string } | { status: "ok"; data: RepSelf };

const ROWS: { key: Metric | "valuePerLead"; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "business", label: "Business" },
  { key: "quotes", label: "Quotes" },
  { key: "talk_hours", label: "Talk time" },
  { key: "valuePerLead", label: "Value per lead" },
];

const money = (v: number) => (Math.abs(v) >= 10_000 ? `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}k` : `$${Math.round(v).toLocaleString()}`);
function fmt(key: Metric | "valuePerLead", v: number | null): string {
  if (v == null) return "—";
  if (key === "business" || key === "valuePerLead") return money(v);
  if (key === "talk_hours") return `${v.toFixed(1)}h`;
  return Math.round(v).toLocaleString();
}
const monthName = (m: string, opts: Intl.DateTimeFormatOptions = { month: "long" }) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const range = (a: string, b: string) => (a === b ? dayName(a) : `${dayName(a)} – ${dayName(b)}`);

function useMyGoals() {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/my-goals")
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok && b.rep === false) setState({ status: "none" });
        else if (r.ok) setState({ status: "ok", data: b as RepSelf });
        else setState({ status: "error", error: typeof b.error === "string" ? b.error : "Couldn't load your goals" });
      })
      .catch(() => !cancelled && setState({ status: "error", error: "Couldn't load your goals" }));
    return () => {
      cancelled = true;
    };
  }, []);
  return [state, setState] as const;
}

/** ▲ 12% / ▼ 8% against the same time last month (nothing when there's nothing to compare). */
function Change({ now, was }: { now: number | null; was: number | null }) {
  if (now == null || was == null || (now === 0 && was === 0)) return <span className="text-muted-foreground">—</span>;
  if (was === 0) return <span className="text-emerald-600 dark:text-emerald-400">new</span>;
  const pct = Math.round(((now - was) / was) * 100);
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 ${up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {up ? "+" : ""}
      {pct}%
    </span>
  );
}

function Bar({ done, goal }: { done: number; goal: number | null }) {
  if (goal == null || goal <= 0) return null;
  const pct = Math.min(100, Math.round((done / goal) * 100));
  return (
    <div className="mt-1 h-1.5 w-full rounded-full bg-muted" title={`${Math.round((done / goal) * 100)}% of goal`}>
      <div className={`h-1.5 rounded-full ${done >= goal ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function PeriodTable({ p }: { p: RepSelf["periods"][number] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1.5 font-medium" />
          <th className="py-1.5 text-right font-medium">{p.label}</th>
          <th className="py-1.5 text-right font-medium">Goal</th>
          <th className="py-1.5 text-right font-medium" title={range(p.wasStart, p.wasEnd)}>
            Last month
          </th>
          <th className="py-1.5 text-right font-medium">Change</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((r) => {
          const now = p.now[r.key];
          const was = p.was[r.key];
          const goal = r.key === "valuePerLead" ? null : p.goal[r.key];
          return (
            <tr key={r.key} className="border-t">
              <td className="py-1.5">{r.label}</td>
              <td className="py-1.5 text-right tabular-nums font-medium">
                {fmt(r.key, now)}
                {r.key !== "valuePerLead" && <Bar done={now ?? 0} goal={goal} />}
              </td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmt(r.key, goal)}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmt(r.key, was)}</td>
              <td className="py-1.5 text-right tabular-nums">
                <Change now={now} was={was} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Ranks({ ranks }: { ranks: RepSelf["ranks"] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {ranks.map((k) => (
        <div key={k.key} className="rounded-md border p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            {k.label} · of {k.of} reps
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {k.items.map((i) => (
              <li key={i.key} className="flex items-baseline justify-between gap-2">
                <span>
                  {i.label}
                  {i.key === "valuePerLead" && i.value != null && <span className="ml-1.5 text-xs text-muted-foreground">{money(i.value)}</span>}
                </span>
                <span className="font-semibold tabular-nums">{i.rank ? `#${i.rank}` : "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function GoalForm({ data, onSaved }: { data: RepSelf; onSaved: (d: RepSelf) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.goals.metrics.map((m) => [m.key, m.target == null ? "" : String(m.target)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = data.goals.metrics.every((m) => values[m.key]?.trim() !== "" && Number(values[m.key]) >= 0);
  const submit = async () => {
    if (!ready || busy) return;
    if (!window.confirm("Submit your goals? After this only your manager or team lead can change them.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/my-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goals: values }),
      });
      const b = await res.json().catch(() => ({}));
      if (res.ok) onSaved(b as RepSelf);
      else setError(typeof b.error === "string" ? b.error : "Couldn't save your goals");
    } catch {
      setError("Couldn't save your goals");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {data.goals.metrics.map((m) => (
          <label key={m.key} className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">
              {m.label} ({m.unit === "$" ? "$" : m.unit} this month)
            </span>
            <Input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={values[m.key]}
              onChange={(e) => setValues((v) => ({ ...v, [m.key]: e.target.value }))}
              className="tabular-nums"
              required
            />
          </label>
        ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!ready || busy}>
          {busy ? "Saving…" : "Submit my goals"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Open through {dayName(data.goals.windowEnds)}. You submit once; after that your manager or team lead makes any changes.
        </span>
      </div>
    </form>
  );
}

/** The profile's card: set goals (1st–5th), the goals, the track record and where they rank. */
export function MyGoalsCard() {
  const [state, setState] = useMyGoals();
  const [tab, setTab] = useState<"day" | "week" | "month">("month");
  const onSaved = useCallback((d: RepSelf) => setState({ status: "ok", data: d }), [setState]);
  if (state.status === "none") return null;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" aria-hidden />
          My goals{state.status === "ok" ? ` — ${monthName(state.data.month, { month: "long", year: "numeric" })}` : ""}
        </CardTitle>
        {state.status === "ok" &&
          (state.data.goals.canSubmit ? (
            <Badge>Set them by {dayName(state.data.goals.windowEnds)}</Badge>
          ) : (
            <Badge variant="outline">{state.data.goals.submittedAt ? `Submitted ${dayName(state.data.goals.submittedAt.slice(0, 10))}` : "Set by your manager"}</Badge>
          ))}
      </CardHeader>
      <CardContent className="space-y-6">
        {state.status === "loading" && <p className="text-sm text-muted-foreground">Loading your numbers…</p>}
        {state.status === "error" && <p className="text-sm text-destructive">{state.error}</p>}
        {state.status === "ok" && (
          <>
            {state.data.goals.canSubmit ? (
              <GoalForm data={state.data} onSaved={onSaved} />
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {state.data.goals.metrics.map((m) => {
                  const done = state.data.periods.find((p) => p.key === "month")!.now[m.key];
                  return (
                    <div key={m.key} className="rounded-md border p-3">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">{m.label}</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums">
                        {fmt(m.key, done)} <span className="text-sm font-normal text-muted-foreground">/ {fmt(m.key, m.target)}</span>
                      </div>
                      <Bar done={done} goal={m.target} />
                    </div>
                  );
                })}
                <p className="col-span-full text-xs text-muted-foreground">
                  Goals are locked for the month. Your manager or team lead can change them.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Track record</h3>
                <div className="inline-flex rounded-md border p-0.5 text-xs" role="tablist">
                  {state.data.periods.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      role="tab"
                      aria-selected={tab === p.key}
                      onClick={() => setTab(p.key)}
                      className={tab === p.key ? "rounded bg-primary px-3 py-1 text-primary-foreground" : "rounded px-3 py-1 text-muted-foreground hover:bg-accent"}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <PeriodTable p={state.data.periods.find((p) => p.key === tab)!} />
              <p className="text-xs text-muted-foreground">
                Compared with the same days last month. A goal for a day or week is its share of the month&apos;s. Value per lead is
                closed business ÷ leads quoted.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Where you rank in your department</h3>
              <Ranks ranks={state.data.ranks} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The clock-in screen's: today and this month against goal and last month, in a few lines. */
export function MyNumbersCompact() {
  const [state] = useMyGoals();
  if (state.status !== "ok") return null;
  const d = state.data;
  const rank = d.ranks.find((k) => k.key === "month");
  const vpl = rank?.items.find((i) => i.key === "valuePerLead");
  return (
    <div className="mt-6 space-y-3 border-t pt-4 text-left">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Target className="h-3.5 w-3.5" aria-hidden />
        Your numbers vs last month
      </div>
      {d.periods
        .filter((p) => p.key !== "week")
        .map((p) => (
          <div key={p.key} className="space-y-1">
            <div className="text-xs font-medium">{p.label}</div>
            <div className="grid grid-cols-4 gap-2 text-sm">
              {(["sales", "business", "quotes", "talk_hours"] as const).map((k) => (
                <div key={k}>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{ROWS.find((r) => r.key === k)!.label}</div>
                  <div className="font-semibold tabular-nums">{fmt(k, p.now[k])}</div>
                  <div className="text-[11px] tabular-nums text-muted-foreground">
                    {p.goal[k] != null ? `goal ${fmt(k, p.goal[k])} · ` : ""}
                    <Change now={p.now[k]} was={p.was[k]} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      {rank && vpl?.rank != null && (
        <p className="text-xs text-muted-foreground">
          This month: #{vpl.rank} of {rank.of} on value per lead ({fmt("valuePerLead", vpl.value)})
        </p>
      )}
      {d.goals.canSubmit && <p className="text-xs font-medium text-primary">Set your {monthName(d.month)} goals on your profile by {dayName(d.goals.windowEnds)}.</p>}
    </div>
  );
}
