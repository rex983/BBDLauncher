"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  EMPLOYEE_ACKNOWLEDGEMENT_TEMPLATE,
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  type IncidentAttachment,
  type IncidentCategory,
  type IncidentSeverity,
} from "@/lib/incidents/types";
import { AlertTriangle, Paperclip, X } from "lucide-react";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Value shape a <input type="datetime-local"> expects: local wall-clock
// time as YYYY-MM-DDTHH:MM (no timezone suffix). Used to prefill the field
// with "right now" every time the dialog opens.
function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

export interface FileIncidentDialogProps {
  // Preselected employee when opened from that employee's timesheet page.
  // When omitted, the dialog shows an employee-picker as the first field
  // (used from /management/incidents where no employee context exists).
  employeeProfileId?: string;
  employeeName?: string;
  trigger?: React.ReactNode;
  onFiled?: () => void;
}

// Manager files a formal incident report. There's no AI drafting step —
// managers write the report body themselves (or paste it from wherever they
// composed it), attach supporting files, and submit. The row lands as
// awaiting_manager_sig; signing happens from the detail dialog.
export function FileIncidentDialog({
  employeeProfileId: preselectedId,
  employeeName: preselectedName,
  trigger,
  onFiled,
}: FileIncidentDialogProps) {
  const needsPicker = !preselectedId;
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>(preselectedId ?? "");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [category, setCategory] = useState<IncidentCategory>("performance");
  // Prefill with "now" so the manager doesn't have to type a timestamp for
  // an incident they're filing about something that just happened. They can
  // still adjust or clear the field for historical incidents.
  const [occurredAt, setOccurredAt] = useState<string>(() => nowLocal());
  const [document, setDocument] = useState("");
  const [attachments, setAttachments] = useState<IncidentAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the scoped employee list only when the dialog opens AND we need
  // a picker. Same endpoint MarkDayOffDialog uses so the scope rules match.
  useEffect(() => {
    if (!open || !needsPicker) return;
    let cancelled = false;
    (async () => {
      setLoadingEmployees(true);
      const res = await fetch("/api/management/timesheets/today");
      if (cancelled) return;
      if (res.ok) {
        const rows: TodayRow[] = await res.json();
        setEmployees(
          rows
            .map((r) => r.profile)
            .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)),
        );
      }
      setLoadingEmployees(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, needsPicker]);

  const employeeProfileId = needsPicker ? selectedId : (preselectedId as string);
  const employeeName = needsPicker
    ? employees.find((e) => e.id === selectedId)?.name ||
      employees.find((e) => e.id === selectedId)?.email ||
      "employee"
    : (preselectedName as string);

  const reset = () => {
    setSelectedId(preselectedId ?? "");
    setTitle("");
    setSeverity("medium");
    setCategory("performance");
    setOccurredAt(nowLocal());
    setDocument("");
    setAttachments([]);
    setError(null);
  };

  const uploadFile = async (file: File) => {
    if (!employeeProfileId) {
      setError("Select an employee before uploading attachments.");
      return;
    }
    setUploading(true);
    setError(null);
    const body = new FormData();
    body.append("file", file);
    body.append("employeeProfileId", employeeProfileId);
    const res = await fetch("/api/incidents/attachments", { method: "POST", body });
    setUploading(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Upload failed");
      return;
    }
    const meta: IncidentAttachment = await res.json();
    setAttachments((prev) => [...prev, meta]);
  };

  const removeAttachment = (path: string) => {
    setAttachments((prev) => prev.filter((a) => a.path !== path));
  };

  const submit = async () => {
    setError(null);
    if (!employeeProfileId) {
      setError("Please pick an employee first.");
      return;
    }
    if (!title.trim()) {
      setError("Please enter a report title.");
      return;
    }
    if (document.trim().length < 10) {
      setError("Report body is too short (min 10 characters).");
      return;
    }
    setSubmitting(true);
    // The DB has description NOT NULL — with the AI step gone there's no
    // longer a separate "raw description" vs "formal document", so we send
    // the same body for both. Column can be repurposed later if we ever
    // want to split them again.
    const res = await fetch("/api/management/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_profile_id: employeeProfileId,
        title,
        severity,
        category,
        occurred_at: occurredAt ? new Date(occurredAt).toISOString() : null,
        description: document,
        document,
        acknowledgement_text: EMPLOYEE_ACKNOWLEDGEMENT_TEMPLATE,
        attachments,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Failed to create report");
      return;
    }
    setOpen(false);
    reset();
    onFiled?.();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <AlertTriangle className="mr-2 h-4 w-4" />
            File incident report
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {needsPicker
              ? "File incident report"
              : `File incident report — ${employeeName}`}
          </DialogTitle>
          <DialogDescription>
            Write or paste the report body, attach any supporting documents,
            then send for signatures.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {needsPicker && (
            <div className="space-y-2">
              <Label htmlFor="i-employee">Employee</Label>
              <Select
                value={selectedId}
                onValueChange={setSelectedId}
                disabled={loadingEmployees}
              >
                <SelectTrigger id="i-employee">
                  <SelectValue
                    placeholder={
                      loadingEmployees ? "Loading employees…" : "Select an employee"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name || e.email}
                      {e.office && (
                        <span className="text-muted-foreground"> · {e.office}</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="i-title">Report title</Label>
            <Input
              id="i-title"
              value={title}
              placeholder="e.g., Repeated tardiness — week of Sep 15"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="i-severity">Severity</Label>
              <Select
                value={severity}
                onValueChange={(v) => setSeverity(v as IncidentSeverity)}
              >
                <SelectTrigger id="i-severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_SEVERITIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="i-category">Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as IncidentCategory)}
              >
                <SelectTrigger id="i-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="i-occurred">Date &amp; time of incident</Label>
            <Input
              id="i-occurred"
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="i-doc">Report body</Label>
            <Textarea
              id="i-doc"
              value={document}
              onChange={(e) => setDocument(e.target.value)}
              rows={14}
              placeholder="Write the report here, or paste it from your preferred editor. Once signed the body is locked."
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="i-attach">Attachments (optional)</Label>
            <Input
              id="i-attach"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.heic,.webp,.doc,.docx,.txt"
              disabled={uploading || attachments.length >= 10}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
                e.target.value = "";
              }}
            />
            {uploading && (
              <p className="text-xs text-muted-foreground">Uploading…</p>
            )}
            {attachments.length > 0 && (
              <ul className="space-y-1">
                {attachments.map((a) => (
                  <li key={a.path} className="flex items-center gap-2 text-sm">
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

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={submitting || !document.trim()}
            >
              {submitting ? "Filing…" : "File & send for signature"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
