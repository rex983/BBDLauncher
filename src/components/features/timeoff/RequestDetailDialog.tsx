"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  TIME_OFF_STATUS_VARIANT,
  TIME_OFF_SUBCATEGORIES,
  TIME_OFF_SUBCATEGORY_HINTS,
  TIME_OFF_TYPES,
  TIME_OFF_TYPE_LABEL,
  type TimeOffAttachment,
  type TimeOffStatus,
  type TimeOffType,
} from "@/lib/timeoff/types";
import { formatBytes } from "@/components/shared/AttachmentPreview";
import { Check, Paperclip, Pencil, Trash2, X } from "lucide-react";

// Everything the dialog needs to render + edit. Callers assemble this
// shape from wherever their data lives (queue API returns profile
// inline; the calendar joins from the range API's profiles list).
export interface DetailRow {
  id: string;
  profile_id: string;
  profile?: { name: string | null; email: string; office: string | null } | null;
  type: TimeOffType;
  subcategory: string | null;
  start_date: string;
  end_date: string;
  full_day: boolean;
  hours: number | null;
  reason: string | null;
  status: TimeOffStatus;
  decided_note: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  created_at: string;
  attachments?: TimeOffAttachment[] | null;
}

interface Props {
  row: DetailRow | null;
  onClose: () => void;
  canDecide: boolean;
  canEdit: boolean;
  onChanged: () => void;
}

function fmtDate(d: string) {
  // Include weekday so managers can eyeball "does this span a weekend / hit
  // a Monday" without pulling out a calendar. Short form keeps the row from
  // wrapping on narrower dialogs.
  return new Date(d + "T00:00:00").toLocaleDateString([], {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
export function RequestDetailDialog({ row, onClose, canDecide, canEdit, onChanged }: Props) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denyNote, setDenyNote] = useState("");

  // Edit form — keep as strings so <Input type="number"> plays nicely.
  const [form, setForm] = useState({
    type: "vacation" as TimeOffType,
    subcategory: "",
    start_date: "",
    end_date: "",
    full_day: true,
    hours: "",
    reason: "",
  });

  // Whenever the incoming row changes, reset local state.
  useEffect(() => {
    setMode("view");
    setError(null);
    setDenyNote("");
    if (row) {
      setForm({
        type: row.type,
        subcategory: row.subcategory || "",
        start_date: row.start_date,
        end_date: row.end_date,
        full_day: row.full_day,
        hours: row.hours != null ? String(row.hours) : "",
        reason: row.reason || "",
      });
    }
  }, [row?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!row) return null;

  const employeeLabel = row.profile?.name || row.profile?.email || "Unknown";
  const subHint = row.subcategory ? TIME_OFF_SUBCATEGORY_HINTS[row.subcategory] : undefined;
  const subOptions = TIME_OFF_SUBCATEGORIES[form.type];

  const decide = async (status: "approved" | "denied", note?: string) => {
    setBusy(true); setError(null);
    const res = await fetch(`/api/management/timeoff/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, decided_note: note || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Failed to update request");
      return;
    }
    onChanged();
    onClose();
  };

  const save = async () => {
    setBusy(true); setError(null);
    if (form.end_date < form.start_date) {
      setBusy(false);
      setError("End date must be on or after start date");
      return;
    }
    if (!form.full_day && !form.hours) {
      setBusy(false);
      setError("Hours required for partial-day requests");
      return;
    }
    const res = await fetch(`/api/management/timeoff/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: form.type,
        subcategory: form.subcategory || null,
        start_date: form.start_date,
        end_date: form.end_date,
        full_day: form.full_day,
        hours: form.full_day ? null : Number(form.hours),
        reason: form.reason || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Failed to save changes");
      return;
    }
    onChanged();
    onClose();
  };

  const del = async () => {
    if (!confirm(`Delete this ${row.status} time-off request for ${employeeLabel}? This cannot be undone.`)) {
      return;
    }
    setBusy(true); setError(null);
    const res = await fetch(`/api/management/timeoff/${row.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Failed to delete request");
      return;
    }
    onChanged();
    onClose();
  };

  const changeType = (t: TimeOffType) => {
    // Reset subcategory when type changes since options don't overlap.
    setForm((f) => ({ ...f, type: t, subcategory: "" }));
  };

  return (
    <Dialog open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{employeeLabel}</span>
            <StatusBadge status={row.status} />
          </DialogTitle>
          <DialogDescription>
            {row.profile?.email}
            {row.profile?.office ? ` · ${row.profile.office}` : ""}
          </DialogDescription>
        </DialogHeader>

        {mode === "view" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{TIME_OFF_TYPE_LABEL[row.type]}</Badge>
              {row.subcategory && <Badge variant="secondary">{row.subcategory}</Badge>}
            </div>
            {subHint && <p className="text-xs text-muted-foreground">{subHint}</p>}

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Start">{fmtDate(row.start_date)}</Field>
              <Field label="End">{fmtDate(row.end_date)}</Field>
              <Field label="Length">
                {row.full_day ? "Full day(s)" : `${row.hours} hour${row.hours === 1 ? "" : "s"}`}
              </Field>
              <Field label="Submitted">{fmtDateTime(row.created_at)}</Field>
              {row.decided_at && (
                <>
                  <Field label={row.status === "approved" ? "Approved" : row.status === "denied" ? "Denied" : "Decided"}>
                    {fmtDateTime(row.decided_at)}
                  </Field>
                  <Field label="Decided by">{row.decided_by || "—"}</Field>
                </>
              )}
            </div>

            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Notes</div>
              <div className="text-sm whitespace-pre-wrap">
                {row.reason || <span className="text-muted-foreground">No notes provided.</span>}
              </div>
            </div>

            {row.decided_note && (
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {row.status === "denied" ? "Denial reason" : "Manager note"}
                </div>
                <div className="text-sm whitespace-pre-wrap">{row.decided_note}</div>
              </div>
            )}

            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Attachments</div>
              {row.attachments && row.attachments.length > 0 ? (
                <ul className="space-y-1">
                  {row.attachments.map((a) => (
                    <li key={a.path}>
                      <a
                        href={`/api/timeoff/attachments/${a.path}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 text-sm underline hover:text-foreground"
                      >
                        <Paperclip className="h-3 w-3" />
                        {a.filename}
                        <span className="text-xs text-muted-foreground">({formatBytes(a.size)})</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">None.</p>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => changeType(v as TimeOffType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIME_OFF_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {subOptions.length > 0 && (
              <div className="space-y-2">
                <Label>Reason category</Label>
                <Select
                  value={form.subcategory}
                  onValueChange={(v) => setForm({ ...form, subcategory: v })}
                >
                  <SelectTrigger>
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
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Start</Label>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>End</Label>
                <Input
                  type="date"
                  value={form.end_date}
                  min={form.start_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
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
                  <Label>Hours</Label>
                  <Input
                    type="number"
                    min="0.25"
                    max="24"
                    step="0.25"
                    value={form.hours}
                    onChange={(e) => setForm({ ...form, hours: e.target.value })}
                  />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                rows={3}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
        )}

        {/* Footer stacks: the denial reason input takes its own full-width
             row (so it doesn't fight the buttons for horizontal space), and
             the action bar below puts destructive/edit actions on the left
             opposite the primary decision buttons on the right. */}
        <DialogFooter className="flex-col gap-3 sm:items-stretch">
          {mode === "view" && row.status === "pending" && canDecide && (
            <Input
              type="text"
              placeholder="Reason for denial (optional — used if you click Deny)"
              value={denyNote}
              onChange={(e) => setDenyNote(e.target.value)}
              className="w-full"
            />
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-2">
              {canEdit && mode === "view" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMode("edit")}
                  disabled={busy}
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              )}
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={del}
                  disabled={busy}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              )}
            </div>

            {mode === "edit" ? (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMode("view")}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={save} disabled={busy}>
                  Save
                </Button>
              </div>
            ) : row.status === "pending" && canDecide ? (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => decide("denied", denyNote)}
                  disabled={busy}
                >
                  <X className="h-4 w-4 mr-1" />
                  Deny
                </Button>
                <Button size="sm" onClick={() => decide("approved")} disabled={busy}>
                  <Check className="h-4 w-4 mr-1" />
                  Approve
                </Button>
              </div>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm mt-0.5">{children}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: TimeOffStatus }) {
  return <Badge variant={TIME_OFF_STATUS_VARIANT[status]}>{status}</Badge>;
}
