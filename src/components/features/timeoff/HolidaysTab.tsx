"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { todayISO } from "@/lib/timeoff/types";
import {
  nextOccurrence,
  recurrenceChoices,
  recurrenceLabel,
  type HolidayRecurrence,
  type HolidayRule,
} from "@/lib/timeoff/holidays";
import { Plus, Repeat, Trash2 } from "lucide-react";

function fmtHoliday(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString([], {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

// Company holidays (migrations 070 + 071): days the whole company is off.
// Admins and managers add and remove them here; a holiday never counts as a
// day off in any time-off total. Each is either one time or every year.
export function HolidaysTab({
  active,
  canManage,
  onChanged,
}: {
  active: boolean;
  canManage: boolean;
  /** Fired after an add or remove so the calendar and summary recount. */
  onChanged: () => void;
}) {
  const [holidays, setHolidays] = useState<HolidayRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [recurrence, setRecurrence] = useState<HolidayRecurrence>("none");
  const [saving, setSaving] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/management/holidays");
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(typeof body?.error === "string" ? body.error : "Couldn't load holidays");
      setHolidays([]);
      return;
    }
    setError(null);
    setHolidays(body as HolidayRule[]);
  }, []);

  // Load the first time the tab is opened, not on page load.
  useEffect(() => {
    if (active && holidays === null) load();
  }, [active, holidays, load]);

  // The ways the picked date can repeat ("every year on Dec 25", "…on the
  // 4th Thursday of November"). A choice the new date doesn't offer falls
  // back to one time.
  const choices = useMemo(() => recurrenceChoices(date), [date]);
  const picked = choices.includes(recurrence) ? recurrence : "none";

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/management/holidays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, date, recurrence: picked }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Couldn't add the holiday");
      return;
    }
    setName("");
    setDate("");
    setRecurrence("none");
    await load();
    onChanged();
  };

  const remove = async (h: HolidayRule) => {
    const what =
      h.recurrence === "none"
        ? `Remove ${h.name} (${fmtHoliday(h.date)})? That day will count as a normal day again.`
        : `Remove ${h.name} for every year? Those days will count as normal days again, past years included.`;
    if (!confirm(what)) return;
    const res = await fetch(`/api/management/holidays/${h.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Couldn't remove the holiday");
      return;
    }
    await load();
    onChanged();
  };

  // Each holiday once, by its next date. One time holidays that have passed
  // sit behind "Show past".
  const today = todayISO();
  const all = useMemo(
    () =>
      (holidays ?? [])
        .map((h) => {
          const next = nextOccurrence(h, today);
          return { rule: h, when: next ?? h.date, past: next === null };
        })
        .sort((a, b) => Number(a.past) - Number(b.past) || a.when.localeCompare(b.when)),
    [holidays, today],
  );
  const pastCount = all.filter((r) => r.past).length;
  const rows = showPast ? all : all.filter((r) => !r.past);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Days the whole company is off. A holiday never counts as a day off when someone
        requests time off around it. Add one for a single date, or have it come back every year.
      </p>

      {canManage && (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <Input
            aria-label="Holiday name"
            placeholder="Holiday name, e.g. Christmas"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            className="w-64"
          />
          <Input
            aria-label="Holiday date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-44"
          />
          <Select value={picked} onValueChange={(v) => setRecurrence(v as HolidayRecurrence)}>
            <SelectTrigger aria-label="Repeats" className="w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((c) => (
                <SelectItem key={c} value={c}>
                  {recurrenceLabel({ date, recurrence: c })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={saving}>
            <Plus className="h-4 w-4 mr-1" />
            {saving ? "Adding…" : "Add holiday"}
          </Button>
        </form>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{showPast ? "Date" : "Next date"}</TableHead>
              <TableHead>Holiday</TableHead>
              <TableHead>Repeats</TableHead>
              {canManage && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {holidays === null && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {holidays !== null && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                  {all.length === 0 ? "No holidays yet." : "No upcoming holidays."}
                </TableCell>
              </TableRow>
            )}
            {rows.map(({ rule: h, when, past }) => (
              <TableRow key={h.id} className={past ? "text-muted-foreground" : ""}>
                <TableCell className="whitespace-nowrap">{fmtHoliday(when)}</TableCell>
                <TableCell className="font-medium">{h.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {h.recurrence !== "none" && <Repeat className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />}
                  {recurrenceLabel(h)}
                </TableCell>
                {canManage && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${h.name}`}
                      onClick={() => remove(h)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pastCount > 0 && (
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showPast}
            onChange={(e) => setShowPast(e.target.checked)}
          />
          Show past holidays ({pastCount})
        </label>
      )}
    </div>
  );
}
