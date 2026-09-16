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
  TIME_OFF_SUBCATEGORY_HINTS,
  TIME_OFF_TYPES,
  TIME_OFF_TYPE_LABEL,
  type TimeOffAttachment,
  type TimeOffStatus,
  type TimeOffType,
} from "@/lib/timeoff/types";
import { Paperclip, Plus, X } from "lucide-react";

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
  attachments?: TimeOffAttachment[] | null;
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

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export interface TimeOffPanelProps {
  initialRequests?: TimeOffRequest[];
  title?: string;
  description?: string;
  /**
   * When true, only requests whose `end_date >= today` are surfaced.
   * Past requests are hidden — used on the profile page so the panel
   * stays focused on what's coming up.
   */
  upcomingOnly?: boolean;
}

export function TimeOffPanel({
  initialRequests,
  title = "My time off",
  description,
  upcomingOnly = false,
}: TimeOffPanelProps) {
  const filter = (list: TimeOffRequest[]) =>
    upcomingOnly
      ? list.filter((r) => r.end_date >= todayISO())
      : list;

  const [rows, setRows] = useState<TimeOffRequest[]>(filter(initialRequests || []));
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
  const [attachments, setAttachments] = useState<TimeOffAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/timeoff");
    const body: TimeOffRequest[] = res.ok ? await res.json() : [];
    setRows(filter(body));
    setLoading(false);
    // filter is a fresh closure per render; safe to omit from deps since
    // it depends only on `upcomingOnly` which is captured lexically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingOnly]);

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
    setAttachments([]);
    setError(null);
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    setError(null);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/timeoff/attachments", { method: "POST", body });
    setUploading(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Upload failed");
      return;
    }
    const meta: TimeOffAttachment = await res.json();
    setAttachments((prev) => [...prev, meta]);
  };

  const removeAttachment = (path: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== path));
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
        attachments: attachments.length > 0 ? attachments : undefined,
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
                        <SelectItem
                          key={s}
                          value={s}
                          title={TIME_OFF_SUBCATEGORY_HINTS[s] || undefined}
                        >
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.subcategory && TIME_OFF_SUBCATEGORY_HINTS[form.subcategory] && (
                    <p className="text-xs text-muted-foreground">
                      {TIME_OFF_SUBCATEGORY_HINTS[form.subcategory]}
                    </p>
                  )}
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

              <div className="space-y-2">
                <Label htmlFor="attachments">Supporting documents (optional)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="attachments"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.heic,.webp,.doc,.docx,.txt"
                    disabled={uploading || attachments.length >= 10}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadFile(f);
                      e.target.value = "";
                    }}
                  />
                </div>
                {uploading && (
                  <p className="text-xs text-muted-foreground">Uploading…</p>
                )}
                {attachments.length > 0 && (
                  <ul className="space-y-1">
                    {attachments.map((a) => (
                      <li
                        key={a.path}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Paperclip className="h-3 w-3 text-muted-foreground" />
                        <span className="truncate flex-1">{a.filename}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatBytes(a.size)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeAttachment(a.path)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Remove attachment"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  PDF, images, or Word docs. 10 MB per file, up to 10 files.
                </p>
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
            {upcomingOnly
              ? "Nothing coming up — submit a request when you know a day off."
              : "You haven\u2019t submitted any time-off requests yet."}
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
                    <div className="space-y-1">
                      {r.reason && <div>{r.reason}</div>}
                      {r.attachments && r.attachments.length > 0 && (
                        <ul className="flex flex-wrap gap-2">
                          {r.attachments.map((a) => (
                            <li key={a.path}>
                              <a
                                href={`/api/timeoff/attachments/${a.path}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs underline hover:text-foreground"
                              >
                                <Paperclip className="h-3 w-3" />
                                {a.filename}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                      {!r.reason && (!r.attachments || r.attachments.length === 0) && "—"}
                    </div>
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
