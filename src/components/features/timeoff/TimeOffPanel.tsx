"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  TIME_OFF_SUBCATEGORIES,
  TIME_OFF_TYPES,
  TIME_OFF_TYPE_LABEL,
  type TimeOffStatus,
  type TimeOffType,
} from "@/lib/timeoff/types";
import { Plus } from "lucide-react";

export interface TimeOffRequest {
  id: string;
  type: TimeOffType;
  subcategory: string | null;
  start_date: string;
  end_date: string;
  full_day: boolean;
  hours: number | null;
  reason: string | null;
  status: TimeOffStatus;
  decided_note: string | null;
  decided_at?: string | null;
  created_at: string;
}

const STATUS_VARIANT: Record<TimeOffStatus, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  approved: "default",
  denied: "destructive",
  cancelled: "secondary",
};

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString([], {
    month: "short", day: "numeric", year: "numeric",
  });
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export interface TimeOffPanelProps {
  initialRequests?: TimeOffRequest[];
  title?: string;
  description?: string;
}

export function TimeOffPanel({
  initialRequests,
  title = "My time off",
  description,
}: TimeOffPanelProps) {
  const [rows, setRows] = useState<TimeOffRequest[]>(initialRequests || []);
  const [loading, setLoading] = useState(initialRequests === undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = todayISO();
  const [form, setForm] = useState({
    type: "vacation" as TimeOffType,
    subcategory: "" as string,
    start_date: today,
    end_date: today,
    full_day: true,
    hours: "",
    reason: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/timeoff");
    setRows(res.ok ? await res.json() : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (initialRequests === undefined) load();
  }, [initialRequests, load]);

  const subOptions = TIME_OFF_SUBCATEGORIES[form.type];

  const resetForm = () => {
    setForm({
      type: "vacation",
      subcategory: "",
      start_date: today,
      end_date: today,
      full_day: true,
      hours: "",
      reason: "",
    });
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/timeoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: form.type,
        subcategory: form.subcategory || null,
        start_date: form.start_date,
        end_date: form.end_date,
        full_day: form.full_day,
        hours: form.full_day ? null : Number(form.hours),
        reason: form.reason || undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Failed to submit request");
      return;
    }
    setDialogOpen(false);
    resetForm();
    load();
  };

  const cancel = async (id: string) => {
    if (!confirm("Cancel this request?")) return;
    const res = await fetch(`/api/timeoff/${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Cancel failed");
      return;
    }
    load();
  };

  // Whenever type changes, wipe subcategory so we don't send a "Sabbatical"
  // paired with type=sick or similar cross-type nonsense.
  const changeType = (t: TimeOffType) => {
    setForm((f) => ({ ...f, type: t, subcategory: "" }));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(o) => {
            setDialogOpen(o);
            if (!o) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Request time off
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request time off</DialogTitle>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="type">Time off type</Label>
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
                  <Label htmlFor="subcategory">Reason category</Label>
                  <Select
                    value={form.subcategory}
                    onValueChange={(v) => setForm({ ...form, subcategory: v })}
                  >
                    <SelectTrigger id="subcategory">
                      <SelectValue placeholder="Select a reason (optional)" />
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
                  <Label htmlFor="start">Start date</Label>
                  <Input
                    id="start"
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end">End date</Label>
                  <Input
                    id="end"
                    type="date"
                    value={form.end_date}
                    min={form.start_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-normal cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.full_day}
                    onChange={(e) => setForm({ ...form, full_day: e.target.checked })}
                  />
                  Full day(s)
                </label>
                {!form.full_day && (
                  <div className="space-y-2">
                    <Label htmlFor="hours">Hours</Label>
                    <Input
                      id="hours"
                      type="number"
                      min="0.25"
                      max="24"
                      step="0.25"
                      value={form.hours}
                      onChange={(e) => setForm({ ...form, hours: e.target.value })}
                      required
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="reason">Additional notes (optional)</Label>
                <Textarea
                  id="reason"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="Anything your manager should know"
                  rows={3}
                />
              </div>

              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDialogOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Submitting…" : "Submit request"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You haven&rsquo;t submitted any time-off requests yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dates</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Length</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">
                    {fmtDate(r.start_date)}
                    {r.start_date !== r.end_date && <> – {fmtDate(r.end_date)}</>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant="outline" className="w-fit">
                        {TIME_OFF_TYPE_LABEL[r.type]}
                      </Badge>
                      {r.subcategory && (
                        <span className="text-xs text-muted-foreground">
                          {r.subcategory}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.full_day ? "Full day" : `${r.hours}h`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                    {r.decided_note && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {r.decided_note}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs">
                    {r.reason || "—"}
                  </TableCell>
                  <TableCell>
                    {r.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => cancel(r.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
