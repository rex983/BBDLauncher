"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
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
  date: string;
  month: string;
  goals: {
    metrics: {
      key: Metric;
      label: string;
      unit: string;
      step: number;
      target: number | null;
      from: "rep" | null;
    }[];
    submittedAt: string | null;
    windowEnds: string;
    canSubmit: boolean;
  };
  periods: {
    key: "day" | "week" | "month";
    label: string;
    start: string;
    end: string;
    wasStart: string;
    wasEnd: string;
    now: Numbers;
    was: Numbers;
    goal: Record<Metric, number | null>;
  }[];
  ranks: {
    key: "month" | "ytd";
    label: string;
    of: number;
    items: {
      key: "valuePerLead" | "sales" | "business";
      label: string;
      value: number | null;
      rank: number | null;
    }[];
  }[];
  history: {
    month: string;
    goal: Record<Metric, number | null>;
    done: Record<Metric, number>;
    valuePerLead: number | null;
  }[];
}
type Kind = "day" | "week" | "month";
type State =
  | { status: "loading" }
  | { status: "none" }
  | { status: "error"; error: string }
  | { status: "ok"; data: RepSelf };

const ROWS: { key: Metric | "valuePerLead"; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "business", label: "Business" },
  { key: "quotes", label: "Quotes" },
  { key: "talk_hours", label: "Talk time" },
  { key: "valuePerLead", label: "Value per lead" },
];

// How each number is worked out, for the hover boxes (the same rules as Rep Insights).
const HELP: Record<Metric | "valuePerLead", string> = {
  sales:
    "Orders you wrote in these dates that are still live in Order Process. An order cancelled later drops out.",
  business:
    "The subtotal of your closed sales in these dates, from Order Process.",
  quotes:
    "New quotes assigned to you in the quoting app in these dates. Revising a quote doesn't count again.",
  talk_hours:
    "Phone time in these dates, in hours: Five9 on call + Five9 Ready (logged in, waiting for a call) + GHL talk.",
  valuePerLead:
    "Business ÷ leads quoted. Leads quoted are the phone numbers you gave a new quote in these dates (web leads included), so it shows what each lead was worth to you.",
};
const GOAL_HELP =
  "Your goal for the month. For a day or a week it's that share of the month's goal by calendar days: one day of a 30-day month gets 1/30 of it. A month with no goal set is 0, never last month's.";

/**
 * A label with a dotted underline that shows a small box explaining it on
 * hover, on keyboard focus, or on a tap. The box is fixed to the screen so a
 * table's scroll area or the clock-in screen can't cut it off.
 */
function Hint({ text, children }: { text: string; children: React.ReactNode }) {
  const [at, setAt] = useState<{ x: number; y: number; below: boolean } | null>(
    null,
  );
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const x = Math.min(
      Math.max(r.left + r.width / 2, 140),
      window.innerWidth - 140,
    );
    const below = r.top < 120;
    setAt({ x, y: below ? r.bottom + 6 : r.top - 6, below });
  };
  return (
    <span
      tabIndex={0}
      className="cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={() => setAt(null)}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={() => setAt(null)}
      onClick={(e) => {
        e.stopPropagation();
        if (at) setAt(null);
        else show(e.currentTarget);
      }}
    >
      {children}
      {at && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[80] w-64 rounded-md border bg-popover px-2.5 py-1.5 text-left text-xs font-normal normal-case tracking-normal text-popover-foreground shadow-md"
          style={{
            left: at.x,
            top: at.y,
            transform: `translate(-50%, ${at.below ? "0" : "-100%"})`,
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

const money = (v: number) =>
  Math.abs(v) >= 10_000
    ? `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}k`
    : `$${Math.round(v).toLocaleString()}`;
function fmt(key: Metric | "valuePerLead", v: number | null): string {
  if (v == null) return "—";
  if (key === "business" || key === "valuePerLead") return money(v);
  if (key === "talk_hours") return `${v.toFixed(1)}h`;
  return Math.round(v).toLocaleString();
}
const monthName = (
  m: string,
  opts: Intl.DateTimeFormatOptions = { month: "long" },
) =>
  new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    ...opts,
  });
const dayName = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
const range = (a: string, b: string) =>
  a === b ? dayName(a) : `${dayName(a)} – ${dayName(b)}`;

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
/** The first of the month `n` months from `d`'s. */
const addMonths = (d: string, n: number) => {
  const x = new Date(
    Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1 + n, 1, 12),
  );
  return x.toISOString().slice(0, 10);
};
/** One step back or forward: a day, a week or a month. */
const step = (kind: Kind, d: string, dir: 1 | -1) =>
  kind === "day"
    ? addDays(d, dir)
    : kind === "week"
      ? addDays(d, 7 * dir)
      : addMonths(d, dir);

/** `date`: a past day to look at (undefined: today). The last numbers stay on screen while the next load. */
function useMyGoals(asProfileId?: string, date?: string) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams();
    if (asProfileId) q.set("as", asProfileId);
    if (date) q.set("date", date);
    setBusy(true);
    fetch(`/api/my-goals${q.size ? `?${q}` : ""}`)
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok && b.rep === false) setState({ status: "none" });
        else if (r.ok) setState({ status: "ok", data: b as RepSelf });
        else
          setState({
            status: "error",
            error:
              typeof b.error === "string"
                ? b.error
                : "Couldn't load your goals",
          });
      })
      .catch(
        () =>
          !cancelled &&
          setState({ status: "error", error: "Couldn't load your goals" }),
      )
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [asProfileId, date]);
  return [state, setState, busy] as const;
}

/** ▲ 12% / ▼ 8% against the same time last month (nothing when there's nothing to compare). */
function Change({ now, was }: { now: number | null; was: number | null }) {
  if (now == null || was == null || (now === 0 && was === 0))
    return <span className="text-muted-foreground">—</span>;
  if (was === 0)
    return <span className="text-emerald-600 dark:text-emerald-400">new</span>;
  const pct = Math.round(((now - was) / was) * 100);
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-1 ${up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
    >
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
    <div
      className="mt-1 h-1.5 w-full rounded-full bg-muted"
      title={`${Math.round((done / goal) * 100)}% of the goal. The bar turns green once it's met.`}
    >
      <div
        className={`h-1.5 rounded-full ${done >= goal ? "bg-emerald-500" : "bg-primary"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function PeriodTable({ p }: { p: RepSelf["periods"][number] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1.5 font-medium" />
          <th className="py-1.5 text-right font-medium">
            <Hint
              text={`What you did ${p.start === p.end ? "on" : "from"} ${range(p.start, p.end)}.`}
            >
              {p.label}
            </Hint>
          </th>
          <th className="py-1.5 text-right font-medium">
            <Hint text={GOAL_HELP}>Goal</Hint>
          </th>
          <th className="py-1.5 text-right font-medium">
            <Hint
              text={`The same days one month earlier: ${range(p.wasStart, p.wasEnd)}.`}
            >
              Last month
            </Hint>
          </th>
          <th className="py-1.5 text-right font-medium">
            <Hint text="How much higher or lower than the same days last month: (now − then) ÷ then. “new” means last month was zero.">
              Change
            </Hint>
          </th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((r) => {
          const now = p.now[r.key];
          const was = p.was[r.key];
          const goal = r.key === "valuePerLead" ? null : p.goal[r.key];
          return (
            <tr key={r.key} className="border-t">
              <td className="py-1.5">
                <Hint text={HELP[r.key]}>{r.label}</Hint>
              </td>
              <td className="py-1.5 text-right tabular-nums font-medium">
                {fmt(r.key, now)}
                {r.key !== "valuePerLead" && (
                  <Bar done={now ?? 0} goal={goal} />
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {fmt(r.key, goal)}
              </td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {fmt(r.key, was)}
              </td>
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
            <Hint
              text={`Your spot among the ${k.of} reps in your office and department; #1 is the highest. Reps with the same number share a spot. Nobody else's names or numbers are shown.${k.key === "ytd" ? " Year to date runs from Jan 1 to the end of the dates you're looking at." : ""}`}
            >
              {k.label} · of {k.of} reps
            </Hint>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {k.items.map((i) => (
              <li
                key={i.key}
                className="flex items-baseline justify-between gap-2"
              >
                <span>
                  <Hint
                    text={`Ranked by ${i.key === "valuePerLead" ? "value per lead" : i.key === "sales" ? "sales" : "business"}. ${HELP[i.key]}`}
                  >
                    {i.label}
                  </Hint>
                  {i.key === "valuePerLead" && i.value != null && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {money(i.value)}
                    </span>
                  )}
                </span>
                <span className="font-semibold tabular-nums">
                  {i.rank ? `#${i.rank}` : "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function GoalForm({
  data,
  onSaved,
  readOnly,
}: {
  data: RepSelf;
  onSaved: (d: RepSelf) => void;
  readOnly: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      data.goals.metrics.map((m) => [
        m.key,
        m.from === "rep" ? String(m.target) : "",
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = data.goals.metrics.every(
    (m) => values[m.key]?.trim() !== "" && Number(values[m.key]) >= 0,
  );
  const submit = async () => {
    if (!ready || busy) return;
    if (readOnly)
      return setError(
        "Read-only while viewing as someone. Exit View as to make changes.",
      );
    // Exactly last month's goals again: ask them to think it through first.
    const i = data.history.findIndex((h) => h.month === data.month);
    const last = i > 0 ? data.history[i - 1] : undefined;
    const same =
      !!last &&
      data.goals.metrics.every(
        (m) =>
          last.goal[m.key] != null &&
          Number(values[m.key]) === last.goal[m.key],
      );
    if (
      same &&
      !window.confirm(
        `These are exactly your goals from ${monthName(last.month, { month: "long" })}. Goals are meant to be set fresh each month: what do you want to hit this month?\n\nOK to submit them anyway, Cancel to change them.`,
      )
    )
      return;
    if (
      !window.confirm(
        "Submit your goals? After this only your manager or team lead can change them.",
      )
    )
      return;
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
      else
        setError(
          typeof b.error === "string" ? b.error : "Couldn't save your goals",
        );
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
              <Hint
                text={`${HELP[m.key]} Your goal is the total for the whole month.`}
              >
                {m.label} ({m.unit === "$" ? "$" : m.unit} this month)
              </Hint>
            </span>
            <Input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={values[m.key]}
              onChange={(e) =>
                setValues((v) => ({ ...v, [m.key]: e.target.value }))
              }
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
          Open through {dayName(data.goals.windowEnds)}. You submit once; after
          that your manager or team lead makes any changes.
        </span>
      </div>
    </form>
  );
}

/** Month by month: the goals and what they did against them (a check when met). A month opens it above. */
function History({
  rows,
  selected,
  onPick,
}: {
  rows: RepSelf["history"];
  selected: string;
  onPick: (month: string) => void;
}) {
  const keys = ["sales", "business", "quotes", "talk_hours"] as const;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Month by month</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1.5 font-medium">
                <Hint text="Each month's total / that month's goal. Green with a ✓ means the goal was met. Click a month to open it.">
                  Month
                </Hint>
              </th>
              {keys.map((k) => (
                <th key={k} className="py-1.5 text-right font-medium">
                  <Hint text={HELP[k]}>
                    {ROWS.find((r) => r.key === k)!.label}
                  </Hint>
                </th>
              ))}
              <th className="py-1.5 text-right font-medium">
                <Hint text={HELP.valuePerLead}>Value per lead</Hint>
              </th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((h) => (
              <tr
                key={h.month}
                onClick={() => onPick(h.month)}
                className={`cursor-pointer border-t hover:bg-accent/50 ${h.month === selected ? "bg-accent/40" : ""}`}
                title="Open this month"
              >
                <td className="py-1.5 whitespace-nowrap">
                  {monthName(h.month, { month: "short", year: "numeric" })}
                </td>
                {keys.map((k) => {
                  const goal = h.goal[k];
                  const met = goal != null && goal > 0 && h.done[k] >= goal;
                  return (
                    <td
                      key={k}
                      className="py-1.5 text-right tabular-nums whitespace-nowrap"
                    >
                      <span
                        className={
                          met
                            ? "font-medium text-emerald-600 dark:text-emerald-400"
                            : ""
                        }
                      >
                        {fmt(k, h.done[k])}
                        {met ? " ✓" : ""}
                      </span>
                      {goal != null && (
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          / {fmt(k, goal)}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="py-1.5 text-right tabular-nums">
                  {fmt("valuePerLead", h.valuePerLead)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Done / goal. Click a month to open it; pick Day or Week and use the
        arrows to zoom in.
      </p>
    </div>
  );
}

/**
 * The profile's card: set goals (1st–5th), the goals, the track record and
 * where they rank. `asProfileId`: View as, that person's card exactly, but
 * submitting is refused.
 */
export function MyGoalsCard({ asProfileId }: { asProfileId?: string }) {
  // Going back in time: the day looked at (undefined = today) and how far zoomed in.
  const [date, setDate] = useState<string | undefined>(undefined);
  const [state, setState, busy] = useMyGoals(asProfileId, date);
  const [tab, setTab] = useState<Kind>("month");
  const onSaved = useCallback(
    (d: RepSelf) => setState({ status: "ok", data: d }),
    [setState],
  );
  if (state.status === "none") return null;
  // Setting this month's goals (1st–5th, not yet submitted).
  const setting = state.status === "ok" && state.data.goals.canSubmit && !date;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" aria-hidden />
          My goals
          {state.status === "ok"
            ? ` — ${monthName(state.data.month, { month: "long", year: "numeric" })}`
            : ""}
        </CardTitle>
        {state.status === "ok" &&
          (state.data.goals.canSubmit ? (
            <Badge>Set them by {dayName(state.data.goals.windowEnds)}</Badge>
          ) : (
            <Badge variant="outline">
              {state.data.goals.submittedAt
                ? `Submitted ${dayName(state.data.goals.submittedAt.slice(0, 10))}`
                : "Set by your manager"}
            </Badge>
          ))}
      </CardHeader>
      <CardContent className="space-y-6">
        {state.status === "loading" && (
          <p className="text-sm text-muted-foreground">Loading your numbers…</p>
        )}
        {state.status === "error" && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
        {state.status === "ok" && (
          <>
            {setting ? (
              <GoalForm
                data={state.data}
                onSaved={onSaved}
                readOnly={!!asProfileId}
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {state.data.goals.metrics.map((m) => {
                  const done = state.data.periods.find(
                    (p) => p.key === "month",
                  )!.now[m.key];
                  return (
                    <div key={m.key} className="rounded-md border p-3">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">
                        <Hint
                          text={`${HELP[m.key]} Done this month / your goal${m.from === "rep" ? "" : " (none set for this month, so 0)"}. The bar turns green once it's met.`}
                        >
                          {m.label}
                        </Hint>
                      </div>
                      <div className="mt-1 text-lg font-semibold tabular-nums">
                        {fmt(m.key, done)}{" "}
                        <span className="text-sm font-normal text-muted-foreground">
                          / {fmt(m.key, m.target)}
                        </span>
                      </div>
                      <Bar done={done} goal={m.target} />
                    </div>
                  );
                })}
                <p className="col-span-full text-xs text-muted-foreground">
                  {state.data.month === state.data.today.slice(0, 7)
                    ? "Goals are locked for the month. Your manager or team lead can change them."
                    : `Goals for ${monthName(state.data.month, { month: "long", year: "numeric" })} and what you did.`}
                </p>
              </div>
            )}

            {setting ? (
              <p className="text-xs text-muted-foreground">
                Set this month&apos;s goals fresh: your track record and past
                months show again once you submit.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">
                      Track record
                      <span
                        className={`ml-2 font-normal text-muted-foreground ${busy ? "animate-pulse" : ""}`}
                      >
                        {tab === "month"
                          ? monthName(state.data.month, {
                              month: "long",
                              year: "numeric",
                            })
                          : (() => {
                              const p = state.data.periods.find(
                                (x) => x.key === tab,
                              )!;
                              return range(p.start, p.end);
                            })()}
                      </span>
                    </h3>
                    <PeriodNav
                      periods={state.data.periods}
                      tab={tab}
                      setTab={setTab}
                      date={date}
                      setDate={setDate}
                      shown={state.data.date}
                      today={state.data.today}
                      busy={busy}
                    />
                  </div>
                  <PeriodTable
                    p={state.data.periods.find((p) => p.key === tab)!}
                  />
                  <p className="text-xs text-muted-foreground">
                    Compared with the same days last month. A goal for a day or
                    week is its share of the month&apos;s. Value per lead is
                    closed business ÷ leads quoted.
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">
                    Where you rank in your department
                  </h3>
                  <Ranks ranks={state.data.ranks} />
                </div>

                <History
                  rows={state.data.history}
                  selected={state.data.month}
                  onPick={(m) => {
                    setTab("month");
                    setDate(
                      m === state.data.today.slice(0, 7)
                        ? undefined
                        : `${m}-01`,
                    );
                  }}
                />
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The clock-in screen's: today and this month against goal and last month, in
 * a few lines. `showStatus`: say so while loading or when there's nothing
 * (the check-in popup), instead of showing nothing. `asProfileId`: someone
 * else's, for an admin's View as (the API checks they may).
 */
export function MyNumbersCompact({
  showStatus = false,
  asProfileId,
}: {
  showStatus?: boolean;
  asProfileId?: string;
}) {
  const [state] = useMyGoals(asProfileId);
  if (state.status !== "ok") {
    if (!showStatus) return null;
    return (
      <p className="py-4 text-sm text-muted-foreground">
        {state.status === "loading"
          ? "Loading your numbers…"
          : state.status === "error"
            ? state.error
            : "There are no numbers for you yet."}
      </p>
    );
  }
  const d = state.data;
  const rank = d.ranks.find((k) => k.key === "month");
  const vpl = rank?.items.find((i) => i.key === "valuePerLead");
  return (
    <div className="mt-6 space-y-3 border-t pt-4 text-left">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Target className="h-3.5 w-3.5" aria-hidden />
        Your numbers vs last month
      </div>
      <CompactPeriods periods={d.periods} whose="your" />
      {rank && vpl?.rank != null && (
        <p className="text-xs text-muted-foreground">
          This month: #{vpl.rank} of {rank.of} on value per lead (
          {fmt("valuePerLead", vpl.value)})
        </p>
      )}
      {d.goals.canSubmit && (
        <p className="text-xs font-medium text-primary">
          Set your {monthName(d.month)} goals on your profile by{" "}
          {dayName(d.goals.windowEnds)}.
        </p>
      )}
    </div>
  );
}

/** Day / Week / Month, back and forward a step, any date, and back to today. */
function PeriodNav({
  periods,
  tab,
  setTab,
  date,
  setDate,
  shown,
  today,
  busy,
}: {
  periods: { key: Kind; label: string }[];
  tab: Kind;
  setTab: (k: Kind) => void;
  /** The day picked (undefined: today). */
  date: string | undefined;
  setDate: (d: string | undefined) => void;
  /** The day the numbers on screen are for. */
  shown: string;
  today: string;
  busy: boolean;
}) {
  const go = (d: string) => setDate(d >= today ? undefined : d);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2"
        aria-label="Back"
        disabled={busy}
        onClick={() => go(step(tab, shown, -1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2"
        aria-label="Forward"
        disabled={busy || !date}
        onClick={() => go(step(tab, shown, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Input
        type="date"
        aria-label="Go to a date"
        className="h-7 w-36 text-xs"
        max={today}
        min="2024-01-01"
        value={shown}
        onChange={(e) => e.target.value && go(e.target.value)}
      />
      {date && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setDate(undefined)}
        >
          Today
        </Button>
      )}
      <div
        className="inline-flex rounded-md border p-0.5 text-xs"
        role="tablist"
      >
        {periods.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={tab === p.key}
            onClick={() => setTab(p.key)}
            className={
              tab === p.key
                ? "rounded bg-primary px-3 py-1 text-primary-foreground"
                : "rounded px-3 py-1 text-muted-foreground hover:bg-accent"
            }
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Today and this month: four numbers each, with the goal and the change on last month. */
function CompactPeriods({
  periods,
  whose,
}: {
  periods: RepSelf["periods"];
  whose: "your" | "the team's" | "the office's";
}) {
  return (
    <>
      {periods
        .filter((p) => p.key !== "week")
        .map((p) => (
          <div key={p.key} className="space-y-1">
            <div className="text-xs font-medium">
              {p.key === "day" ? "Today" : "This month"}
            </div>
            <div className="grid grid-cols-4 gap-2 text-sm">
              {(["sales", "business", "quotes", "talk_hours"] as const).map(
                (k) => (
                  <div key={k}>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      <Hint
                        text={`${HELP[k]} “goal” is ${p.key === "day" ? "today's" : "this month's"} share of ${whose === "your" ? "your monthly goal" : `${whose} reps' monthly goals added up`}; the % compares with the same days last month.`}
                      >
                        {ROWS.find((r) => r.key === k)!.label}
                      </Hint>
                    </div>
                    <div className="font-semibold tabular-nums">
                      {fmt(k, p.now[k])}
                    </div>
                    <div className="text-[11px] tabular-nums text-muted-foreground">
                      {p.goal[k] != null ? `goal ${fmt(k, p.goal[k])} · ` : ""}
                      <Change now={p.now[k]} was={p.was[k]} />
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        ))}
    </>
  );
}

// ---- Team and office reports (team leaders and managers) ----------------

type GroupPeriod = RepSelf["periods"][number] & {
  reps: {
    name: string;
    now: Numbers;
    was: Numbers;
    goal: Record<Metric, number | null>;
  }[];
};
interface GroupReport {
  key: "team" | "office";
  title: string;
  reps: number;
  periods: GroupPeriod[];
}
type GroupState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ok"; today: string; date: string; reports: GroupReport[] };

/** The team report (team leaders) and office report (managers) from Rep Insights (/api/my-reports). */
function useGroupReports(asProfileId?: string, date?: string) {
  const [state, setState] = useState<GroupState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams();
    if (asProfileId) q.set("as", asProfileId);
    if (date) q.set("date", date);
    setBusy(true);
    fetch(`/api/my-reports${q.size ? `?${q}` : ""}`)
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.ok)
          setState({
            status: "ok",
            today: b.today,
            date: b.date,
            reports: b.reports ?? [],
          });
        else
          setState({
            status: "error",
            error:
              typeof b.error === "string"
                ? b.error
                : "Couldn't load the report",
          });
      })
      .catch(
        () =>
          !cancelled &&
          setState({ status: "error", error: "Couldn't load the report" }),
      )
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [asProfileId, date]);
  return [state, busy] as const;
}

const reportName = (r: GroupReport) =>
  r.key === "team" ? "Team report" : "Office report";

/** done / goal, green with a check once met. */
function DoneOfGoal({
  k,
  done,
  goal,
}: {
  k: Metric;
  done: number;
  goal: number | null;
}) {
  const met = goal != null && goal > 0 && done >= goal;
  return (
    <>
      <span
        className={
          met ? "font-medium text-emerald-600 dark:text-emerald-400" : ""
        }
      >
        {fmt(k, done)}
        {met ? " \u2713" : ""}
      </span>
      {goal != null && (
        <span className="text-xs text-muted-foreground"> / {fmt(k, goal)}</span>
      )}
    </>
  );
}

function RepTable({ p, office }: { p: GroupPeriod; office: boolean }) {
  const keys = ["sales", "business", "quotes", "talk_hours"] as const;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1.5 font-medium">
              <Hint
                text={`Every rep on ${office ? "the office's roster" : "the team"}, most business first. Each number is done / their goal for these dates; green with a check means it's met.`}
              >
                Rep
              </Hint>
            </th>
            {keys.map((k) => (
              <th key={k} className="py-1.5 text-right font-medium">
                <Hint text={HELP[k]}>
                  {ROWS.find((r) => r.key === k)!.label}
                </Hint>
              </th>
            ))}
            <th className="py-1.5 text-right font-medium">
              <Hint text={HELP.valuePerLead}>Value per lead</Hint>
            </th>
            <th className="py-1.5 text-right font-medium">
              <Hint text="Their business against the same days last month: (now − then) ÷ then.">
                Business change
              </Hint>
            </th>
          </tr>
        </thead>
        <tbody>
          {p.reps.map((r) => (
            <tr key={r.name} className="border-t">
              <td className="py-1.5 whitespace-nowrap">{r.name}</td>
              {keys.map((k) => (
                <td
                  key={k}
                  className="py-1.5 text-right tabular-nums whitespace-nowrap"
                >
                  <DoneOfGoal k={k} done={r.now[k]} goal={r.goal[k]} />
                </td>
              ))}
              <td className="py-1.5 text-right tabular-nums">
                {fmt("valuePerLead", r.now.valuePerLead)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                <Change now={r.now.business} was={r.was.business} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The profile's office report (managers): the totals against the reps' goals
 * added up and the same days last month, then rep by rep, for any day, week
 * or month. Team leads see their team only on the clock-in screen.
 * `asProfileId`: View as, that person's report.
 */
export function TeamReportsCard({ asProfileId }: { asProfileId?: string }) {
  const [date, setDate] = useState<string | undefined>(undefined);
  const [state, busy] = useGroupReports(asProfileId, date);
  const [tab, setTab] = useState<Kind>("month");
  if (state.status === "loading") return null;
  if (state.status === "error")
    return <p className="text-sm text-destructive">{state.error}</p>;
  return (
    <>
      {/* Team leads see their team only on the clock-in screen; the profile keeps the office report. */}
      {state.reports
        .filter((r) => r.key === "office")
        .map((r) => {
          const p = r.periods.find((x) => x.key === tab)!;
          return (
            <Card key={r.key}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" aria-hidden />
                  {reportName(r)} — {r.title}
                </CardTitle>
                <Badge variant="outline">
                  {r.reps} rep{r.reps === 1 ? "" : "s"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    <Hint
                      text={`All ${r.reps} reps added up. The goal is their goals for these dates added up (a rep with none set counts 0).`}
                    >
                      Totals
                    </Hint>
                    <span
                      className={`ml-2 font-normal text-muted-foreground ${busy ? "animate-pulse" : ""}`}
                    >
                      {tab === "month"
                        ? monthName(p.start.slice(0, 7), {
                            month: "long",
                            year: "numeric",
                          })
                        : range(p.start, p.end)}
                    </span>
                  </h3>
                  <PeriodNav
                    periods={r.periods}
                    tab={tab}
                    setTab={setTab}
                    date={date}
                    setDate={setDate}
                    shown={state.date}
                    today={state.today}
                    busy={busy}
                  />
                </div>
                <PeriodTable p={p} />
                <h3 className="text-sm font-semibold">Rep by rep</h3>
                <RepTable p={p} office={r.key === "office"} />
              </CardContent>
            </Card>
          );
        })}
    </>
  );
}

/** The clock-in screen's: each report's today and this month, in a few lines. */
export function TeamReportsCompact() {
  const [state] = useGroupReports();
  if (state.status !== "ok" || !state.reports.length) return null;
  return (
    <>
      {state.reports.map((r) => (
        <div key={r.key} className="mt-6 space-y-3 border-t pt-4 text-left">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {reportName(r)}: {r.title} · {r.reps} reps
          </div>
          <CompactPeriods
            periods={r.periods}
            whose={r.key === "team" ? "the team's" : "the office's"}
          />
        </div>
      ))}
    </>
  );
}
