"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { todayISO } from "@/lib/timeoff/types";
import type { Holiday } from "@/lib/timeoff/holidays";
import { Plus, Trash2 } from "lucide-react";

function fmtHoliday(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString([], {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

// Company holidays (migration 070): days the whole company is off. Admins
// and managers add and remove them here; a holiday never counts as a day
// off in any time-off total.
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
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
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
    setHolidays(body as Holiday[]);
  }, []);

  // Load the first time the tab is opened, not on page load.
  useEffect(() => {
    if (active && holidays === null) load();
  }, [active, holidays, load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/management/holidays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, date }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Couldn't add the holiday");
      return;
    }
    setName("");
    setDate("");
    await load();
    onChanged();
  };

  const remove = async (h: Holiday) => {
    if (!confirm(`Remove ${h.name} (${fmtHoliday(h.date)})? That day will count as a normal day again.`)) return;
    const res = await fetch(`/api/management/holidays/${h.id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Couldn't remove the holiday");
      return;
    }
    await load();
    onChanged();
  };

  const today = todayISO();
  const all = holidays ?? [];
  const pastCount = all.filter((h) => h.date < today).length;
  const rows = showPast ? all : all.filter((h) => h.date >= today);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Days the whole company is off. A holiday never counts as a day off when someone
        requests time off around it.
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
              <TableHead>Date</TableHead>
              <TableHead>Holiday</TableHead>
              {canManage && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {holidays === null && (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {holidays !== null && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">
                  {all.length === 0 ? "No holidays yet." : "No upcoming holidays."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((h) => (
              <TableRow key={h.id} className={h.date < today ? "text-muted-foreground" : ""}>
                <TableCell className="whitespace-nowrap">{fmtHoliday(h.date)}</TableCell>
                <TableCell className="font-medium">{h.name}</TableCell>
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
