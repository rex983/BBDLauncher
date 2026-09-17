"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  TIME_OFF_MANAGER_REASONS,
  TIME_OFF_SUBCATEGORIES,
  TIME_OFF_TYPES,
  type TimeOffType,
} from "@/lib/timeoff/types";
import { CalendarPlus } from "lucide-react";

interface EmployeeOption {
  id: string;
  name: string | null;
  email: string;
  office: string | null;
  department: string | null;
}

interface TodayRow {
  profile: EmployeeOption;
}

interface Props {
  onCreated?: () => void;
  viewAsOffice?: string | null;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function MarkDayOffDialog({ onCreated, viewAsOffice }: Props) {
  const [open, setOpen] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayISO();
  const [form, setForm] = useState({
    profile_id: "",
    type: "sick" as TimeOffType,
    subcategory: "",
    start_date: today,
    end_date: today,
    full_day: true,
    hours: "",
    reason_preset: "Sick day" as string,
    reason_custom: "",
  });

  const resetForm = useCallback(() => {
    const t = todayISO();
    setForm({
      profile_id: "",
      type: "sick",
      subcategory: "",
      start_date: t,
      end_date: t,
      full_day: true,
      hours: "",
      reason_preset: "Sick day",
      reason_custom: "",
    });
    setError(null);
  }, []);

  // Load the scoped employee list only when the dialog opens — no need
  // to hold every profile in memory the whole page-view.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingEmployees(true);
      const p = new URLSearchParams();
      if (viewAsOffice) p.set("office", viewAsOffice);
      const url = `/api/management/timesheets/today${p.toString() ? `?${p.toString()}` : ""}`;
      const res = await fetch(url);
      if (cancelled) return;
      if (res.ok) {
        const rows: TodayRow[] = await res.json();
        setEmployees(
          rows
            .map((r) => r.profile)
            .sort((a, b) => {
              const an = (a.name || a.email).toLowerCase();
              const bn = (b.name || b.email).toLowerCase();
              return an.localeCompare(bn);
            }),
        );
      } else {
        setEmployees([]);
      }
      setLoadingEmployees(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, viewAsOffice]);

  const subOptions = useMemo(() => TIME_OFF_SUBCATEGORIES[form.type], [form.type]);

  const changeType = (t: TimeOffType) => {
    setForm((f) => ({ ...f, type: t, subcategory: "" }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.profile_id) {
      setError("Pick an employee.");
      return;
    }
    setSubmitting(true);
    setError(null);
    // Resolve reason: preset unless "Other" is picked, in which case the
    // free-text field wins. Empty preset means "unspecified" → send null.
    const resolvedReason =
      form.reason_preset === "Other"
        ? form.reason_custom.trim()
        : form.reason_preset;
    const res = await fetch("/api/management/timeoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile_id: form.profile_id,
        type: form.type,
        subcategory: form.subcategory || null,
        start_date: form.start_date,
        end_date: form.end_date,
        full_day: form.full_day,
        hours: form.full_day ? null : Number(form.hours),
        reason: resolvedReason || undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Failed to create");
      return;
    }
    setOpen(false);
    resetForm();
    onCreated?.();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <CalendarPlus className="h-4 w-4 mr-1" />
          Mark day off
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark an employee out</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="employee">Employee</Label>
            <Select
              value={form.profile_id}
              onValueChange={(v) => setForm((f) => ({ ...f, profile_id: v }))}
            >
              <SelectTrigger id="employee">
                <SelectValue placeholder={loadingEmployees ? "Loading…" : "Select employee"} />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name || e.email}
                    {e.office ? ` · ${e.office}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <Select value={form.type} onValueChange={(v) => changeType(v as TimeOffType)}>
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_OFF_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {subOptions.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="subcategory">Subcategory (optional)</Label>
              <Select
                value={form.subcategory}
                onValueChange={(v) => setForm((f) => ({ ...f, subcategory: v }))}
              >
                <SelectTrigger id="subcategory">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {subOptions.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="start_date">Start date</Label>
              <Input
                id="start_date"
                type="date"
                value={form.start_date}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => ({
                    ...f,
                    start_date: v,
                    // Keep end >= start.
                    end_date: f.end_date < v ? v : f.end_date,
                  }));
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end_date">End date</Label>
              <Input
                id="end_date"
                type="date"
                value={form.end_date}
                min={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.full_day}
                onChange={(e) => setForm((f) => ({ ...f, full_day: e.target.checked }))}
              />
              Full day
            </label>
            {!form.full_day && (
              <div className="space-y-2">
                <Label htmlFor="hours">Hours</Label>
                <Input
                  id="hours"
                  type="number"
                  min="0.5"
                  max="24"
                  step="0.5"
                  value={form.hours}
                  onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
                  required={!form.full_day}
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Select
              value={form.reason_preset}
              onValueChange={(v) => setForm((f) => ({ ...f, reason_preset: v }))}
            >
              <SelectTrigger id="reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_OFF_MANAGER_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.reason_preset === "Other" && (
              <Textarea
                rows={2}
                value={form.reason_custom}
                onChange={(e) => setForm((f) => ({ ...f, reason_custom: e.target.value }))}
                placeholder="Describe the reason"
              />
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Mark off"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
