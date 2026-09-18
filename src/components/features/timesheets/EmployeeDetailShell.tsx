"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, LogIn, LogOut, Utensils, Coffee, Wand2 } from "lucide-react";
import {
  computeState, formatDuration, STATUS_LABEL,
  type PunchEventType, type TimePunch,
} from "@/lib/timesheets/state";
import { computeDayWorkedMs } from "@/lib/timesheets/weekly";
import { localDateInZone } from "@/lib/timesheets/tz";
import { canEditTimeData } from "@/lib/auth/permissions";
import {
  requestDays,
  TIME_OFF_TYPE_LABEL,
  type TimeOffType,
} from "@/lib/timeoff/types";
import type {
  EmployeeDetailData,
  EmployeeDetailProfile,
  WindowTimeOffRow,
  YtdBreakdown,
} from "@/lib/timesheets/detail";
import { ExportMenu } from "@/components/ui/export-menu";
import type { ExportColumn } from "@/lib/export/csv";

const EVENT_TYPES: { value: PunchEventType; label: string }[] = [
  { value: "clock_in",    label: "Clock in" },
  { value: "clock_out",   label: "Clock out" },
  { value: "lunch_start", label: "Lunch start" },
  { value: "lunch_end",   label: "Lunch end" },
  { value: "break_start", label: "Break start" },
  { value: "break_end",   label: "Break end" },
];

const TIME_OFF_TYPES_ORDERED: TimeOffType[] = [
  "sick",
  "vacation",
  "personal",
  "parental",
  "other",
];

function emptyYtd(): YtdBreakdown {
  return { vacation: 0, sick: 0, personal: 0, parental: 0, other: 0, total: 0 };
}

function fmtDays(d: number): string {
  if (d === 0) return "0";
  return (Math.round(d * 10) / 10).toString();
}

function fmtDateShort(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Convert a UTC ISO to a value acceptable by <input type="datetime-local">.
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToISO(local: string): string {
  return new Date(local).toISOString();
}

// Punches export column set — dates are ET-local (matches how the UI
// buckets days) and times are user-local so a manager reading the CSV on
// a laptop in ET sees the same wall-clock strings they see on-screen.
const PUNCH_COLUMNS: ExportColumn<TimePunch>[] = [
  {
    key: "date",
    label: "Date (ET)",
    get: (p) => localDateInZone(new Date(p.occurred_at)),
  },
  {
    key: "time",
    label: "Time",
    get: (p) =>
      new Date(p.occurred_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
  },
  {
    key: "occurred_at",
    label: "Occurred at (ISO)",
    get: (p) => new Date(p.occurred_at),
  },
  { key: "event_type", label: "Event", get: (p) => p.event_type },
  { key: "source", label: "Source", get: (p) => p.source },
  { key: "note", label: "Note", get: (p) => p.note ?? "" },
  { key: "id", label: "Punch ID", get: (p) => p.id },
];

const TIME_OFF_WINDOW_COLUMNS: ExportColumn<WindowTimeOffRow>[] = [
  { key: "start_date", label: "Start date", get: (r) => r.start_date },
  { key: "end_date", label: "End date", get: (r) => r.end_date },
  { key: "type", label: "Type", get: (r) => TIME_OFF_TYPE_LABEL[r.type] },
  { key: "subcategory", label: "Subcategory", get: (r) => r.subcategory ?? "" },
  { key: "full_day", label: "Full day", get: (r) => r.full_day },
  { key: "hours", label: "Hours", get: (r) => r.hours ?? "" },
  { key: "days", label: "Days", get: (r) => requestDays(r) },
  { key: "status", label: "Status", get: (r) => r.status },
  { key: "reason", label: "Reason", get: (r) => r.reason ?? "" },
];

export default function EmployeeDetailShell({
  profileId,
  initialDays,
  initialData,
  initialError,
}: {
  profileId: string;
  initialDays: number;
  initialData: EmployeeDetailData | null;
  initialError: string | null;
}) {
  const { data: session } = useSession();
  const canEdit = canEditTimeData(session?.user?.role);

  const [profile, setProfile] = useState<EmployeeDetailProfile | null>(
    initialData?.profile ?? null,
  );
  const [punches, setPunches] = useState<TimePunch[]>(initialData?.punches ?? []);
  const [timeOffWindow, setTimeOffWindow] = useState<WindowTimeOffRow[]>(
    initialData?.time_off.window ?? [],
  );
  const [timeOffYtd, setTimeOffYtd] = useState<YtdBreakdown>(
    initialData?.time_off.ytd ?? emptyYtd(),
  );
  const [loading, setLoading] = useState(
    initialData === null && initialError === null,
  );
  const [error, setError] = useState<string | null>(initialError);
  const [days, setDays] = useState(initialDays);
  const [dialogOpen, setDialogOpen] = useState(false);
  // When null the dialog is in Add mode; otherwise it's editing an existing
  // punch and PATCHes /api/management/timesheets/punches/[editingId].
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    event_type: "clock_in" as PunchEventType,
    occurred_at: isoToLocalInput(new Date().toISOString()),
    note: "",
  });

  // Skip the initial fetch when the server already hydrated us. Days-selector
  // changes on the client still refetch as before.
  const skipInitialFetchRef = useRef(
    initialData !== null || initialError !== null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);
    const url = `/api/management/timesheets/employee/${profileId}?from=${from.toISOString()}&to=${now.toISOString()}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      setProfile(data.profile);
      setPunches(data.punches);
      if (data.time_off) {
        setTimeOffWindow(data.time_off.window ?? []);
        setTimeOffYtd(data.time_off.ytd ?? emptyYtd());
      }
    } else {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Failed to load");
    }
    setLoading(false);
  }, [profileId, days]);

  useEffect(() => {
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false;
      return;
    }
    load();
  }, [load]);

  const state = computeState(punches);

  const openAdd = () => {
    setEditingId(null);
    setForm({
      event_type: "clock_in",
      occurred_at: isoToLocalInput(new Date().toISOString()),
      note: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (p: TimePunch) => {
    setEditingId(p.id);
    setForm({
      event_type: p.event_type,
      occurred_at: isoToLocalInput(p.occurred_at),
      note: p.note ?? "",
    });
    setDialogOpen(true);
  };

  const submitPunch = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = JSON.stringify({
      event_type: form.event_type,
      occurred_at: localInputToISO(form.occurred_at),
      note: form.note || (editingId ? null : undefined),
    });
    const res = editingId
      ? await fetch(`/api/management/timesheets/punches/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body,
        })
      : await fetch(`/api/management/timesheets/employee/${profileId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      alert(typeof b.error === "string" ? b.error : editingId ? "Edit failed" : "Failed to add punch");
      return;
    }
    setDialogOpen(false);
    setEditingId(null);
    load();
  };

  const deletePunch = async (id: string) => {
    if (!confirm("Delete this punch?")) return;
    const res = await fetch(`/api/management/timesheets/punches/${id}`, { method: "DELETE" });
    if (!res.ok) { alert("Delete failed"); return; }
    load();
  };

  // Bucket punches by ET-local day (matches other timesheet math). Days
  // render newest-first; within a day, punches stay chronological so the
  // reader can follow the shift top-to-bottom.
  const now = new Date();
  const byDay = new Map<string, TimePunch[]>();
  for (const p of punches) {
    const key = localDateInZone(new Date(p.occurred_at));
    const list = byDay.get(key) || [];
    list.push(p);
    byDay.set(key, list);
  }
  const days_desc = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  for (const [, list] of days_desc) {
    list.sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">
            <Link href="/management/timesheets" className="hover:underline">
              ← Timesheets
            </Link>
          </div>
          <h1 className="text-2xl font-bold">
            {profile?.name || profile?.email || "…"}
          </h1>
          <div className="text-muted-foreground text-sm">
            {profile?.email}
            {profile?.office && <> · <Badge variant="outline">{profile.office}</Badge></>}
            {profile?.department && <> · <Badge variant="outline">{profile.department}</Badge></>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[140px] print:hidden"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 1 day</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <ExportMenu
            filename={`timesheet-${(profile?.name || profile?.email || profileId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${days}d`}
            rows={punches}
            columns={PUNCH_COLUMNS}
            disabled={loading || punches.length === 0}
          />
          {canEdit && (
            <Button onClick={openAdd} className="print:hidden"><Plus className="mr-2 h-4 w-4" />Add punch</Button>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Status" value={STATUS_LABEL[state.status]} />
        <StatCard label={`Worked (last ${days}d)`} value={formatDuration(state.worked_ms)} />
        <StatCard label="Lunch" value={formatDuration(state.lunch_ms)} />
        <StatCard label="Breaks" value={formatDuration(state.break_ms)} />
        <StatCard label="Time off (YTD)" value={`${fmtDays(timeOffYtd.total)} d`} />
      </div>

      {timeOffYtd.total > 0 && (
        <Card className="gap-0 py-0">
          <CardHeader className="flex flex-row items-center justify-between px-4 py-2 border-b">
            <div className="text-sm font-semibold">Time off used — YTD</div>
            <div className="text-xs text-muted-foreground">
              Approved only · partial days = hours ÷ 8
            </div>
          </CardHeader>
          <CardContent className="px-4 py-3">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {TIME_OFF_TYPES_ORDERED.map((t) => (
                <div key={t} className="flex items-baseline gap-1.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    {TIME_OFF_TYPE_LABEL[t]}
                  </span>
                  <span className="tabular-nums font-medium">
                    {fmtDays(timeOffYtd[t])} d
                  </span>
                </div>
              ))}
              <div className="flex items-baseline gap-1.5">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Total
                </span>
                <span className="tabular-nums font-semibold">
                  {fmtDays(timeOffYtd.total)} d
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {timeOffWindow.length > 0 && (
        <Card className="gap-0 py-0">
          <CardHeader className="flex flex-row items-center justify-between px-4 py-2 border-b">
            <div className="text-sm font-semibold">
              Time off in this window
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xs text-muted-foreground">
                {timeOffWindow.length} {timeOffWindow.length === 1 ? "entry" : "entries"}
              </div>
              <ExportMenu
                filename={`timeoff-${(profile?.name || profile?.email || profileId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${days}d`}
                rows={timeOffWindow}
                columns={TIME_OFF_WINDOW_COLUMNS}
                size="sm"
              />
            </div>
          </CardHeader>
          <CardContent className="px-4 py-0">
            <ul className="divide-y">
              {timeOffWindow.map((r) => {
                const rangeLabel =
                  r.start_date === r.end_date
                    ? fmtDateShort(r.start_date)
                    : `${fmtDateShort(r.start_date)} – ${fmtDateShort(r.end_date)}`;
                const durationLabel = r.full_day
                  ? `${fmtDays(requestDays(r))} d`
                  : `${r.hours}h`;
                return (
                  <li
                    key={r.id}
                    className="grid grid-cols-[220px_120px_60px_60px_1fr] items-center gap-3 py-1.5 text-sm leading-tight"
                  >
                    <div className="tabular-nums font-medium">{rangeLabel}</div>
                    <div>
                      <Badge variant="outline" className="mr-1">
                        {TIME_OFF_TYPE_LABEL[r.type]}
                      </Badge>
                      {r.subcategory && (
                        <span className="text-xs text-muted-foreground">
                          {r.subcategory}
                        </span>
                      )}
                    </div>
                    <div className="tabular-nums text-xs">{durationLabel}</div>
                    <div className="text-xs">
                      <Badge
                        variant={r.status === "approved" ? "default" : "outline"}
                        className="capitalize"
                      >
                        {r.status}
                      </Badge>
                    </div>
                    <div className="min-w-0 text-xs text-muted-foreground truncate">
                      {r.reason || <span className="opacity-60">—</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {loading && <p className="text-muted-foreground">Loading…</p>}

      {!loading && days_desc.length === 0 && (
        <p className="text-muted-foreground">No punches in this window.</p>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditingId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit punch" : "Add punch"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitPunch} className="space-y-4">
            <div className="space-y-2">
              <Label>Event</Label>
              <Select
                value={form.event_type}
                onValueChange={(v) => setForm({ ...form, event_type: v as PunchEventType })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((e) => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Time</Label>
              <Input
                type="datetime-local"
                value={form.occurred_at}
                onChange={(e) => setForm({ ...form, occurred_at: e.target.value })}
                required
              />
              <p className="text-xs text-muted-foreground">
                {editingId
                  ? "Adjust the actual clock-in/out time — the punch will be marked as an admin edit."
                  : "Backfill a missing punch — use this when an employee forgot."}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Note (optional)</Label>
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="e.g. Employee arrived at 10:00, forgot to punch"
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit">{editingId ? "Save" : "Add"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <div className="space-y-2">
        {days_desc.map(([dayKey, list]) => {
          const dayState = computeState(list, dayKey === localDateInZone(now) ? now : new Date(list[list.length - 1].occurred_at));
          const dayWorkedMs = computeDayWorkedMs(list, dayKey, now);
          return (
            <Card key={dayKey} className="gap-0 py-0">
              <CardHeader className="flex flex-row items-center justify-between gap-4 px-4 py-2 border-b">
                <div className="text-sm font-semibold">{fmtDayHeader(dayKey)}</div>
                <div className="flex items-center gap-3 text-xs">
                  <DayStat label="Worked" value={formatDuration(dayWorkedMs)} strong />
                  <DayStat label="Lunch" value={formatDuration(dayState.lunch_ms)} />
                  <DayStat label="Breaks" value={formatDuration(dayState.break_ms)} />
                </div>
              </CardHeader>
              <CardContent className="px-4 py-0">
                <ul className="divide-y">
                  {list.map((p) => (
                    <li
                      key={p.id}
                      className="grid grid-cols-[72px_150px_64px_1fr_64px] items-center gap-3 py-1 group text-sm leading-tight"
                    >
                      <div className="tabular-nums font-medium">
                        {new Date(p.occurred_at).toLocaleTimeString([], {
                          hour: "numeric", minute: "2-digit",
                        })}
                      </div>
                      <div className="flex items-center gap-2">
                        <EventIcon type={p.event_type} />
                        <span>{EVENT_LABEL[p.event_type]}</span>
                      </div>
                      <div className="text-xs">
                        {p.source === "auto" ? (
                          <span title="System-generated" className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <Wand2 className="h-3 w-3" />
                            auto
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{p.source}</span>
                        )}
                      </div>
                      <div className="min-w-0 text-xs text-muted-foreground truncate">
                        {p.note || <span className="opacity-60">—</span>}
                      </div>
                      <div className="flex gap-0.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        {canEdit && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => openEdit(p)}
                              title="Edit this punch"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => deletePunch(p.id)}
                              title="Delete this punch"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

const EVENT_LABEL: Record<PunchEventType, string> = {
  clock_in:    "Clock in",
  clock_out:   "Clock out",
  lunch_start: "Lunch start",
  lunch_end:   "Lunch end",
  break_start: "Break start",
  break_end:   "Break end",
};

function EventIcon({ type }: { type: PunchEventType }) {
  const cls = "h-3.5 w-3.5";
  if (type === "clock_in")    return <LogIn    className={`${cls} text-emerald-600 dark:text-emerald-400`} />;
  if (type === "clock_out")   return <LogOut   className={`${cls} text-rose-600 dark:text-rose-400`} />;
  if (type === "lunch_start" || type === "lunch_end") return <Utensils className={`${cls} text-amber-600 dark:text-amber-400`} />;
  return <Coffee className={`${cls} text-sky-600 dark:text-sky-400`} />;
}

// dayKey is a YYYY-MM-DD in ET-local — render as e.g. "Wed, Sep 16, 2026".
function fmtDayHeader(dayKey: string) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString([], {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}

function DayStat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className={`tabular-nums ${strong ? "font-semibold" : "text-muted-foreground"}`}>{value}</span>
    </div>
  );
}
