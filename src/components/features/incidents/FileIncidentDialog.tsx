"use client";

import { useEffect, useRef, useState } from "react";
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
  type IncidentCategory,
  type IncidentSeverity,
} from "@/lib/incidents/types";
import {
  FileKindIcon,
  formatBytes,
  isImageMime,
} from "@/components/shared/AttachmentPreview";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react";
import { useIncidentAttachmentUploads } from "./useIncidentAttachmentUploads";

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
  // Report body is split into three sections. First two are visible to the
  // employee at signing time; the third is management-only and never
  // reaches the /api/incidents endpoint that employees hit.
  const [problem, setProblem] = useState("");
  const [proposedSolution, setProposedSolution] = useState("");
  const [managerNotes, setManagerNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const {
    uploads,
    uploadingCount,
    errorCount,
    submittedAttachments,
    queueFiles,
    retryUpload,
    removeUpload,
    reset: resetUploads,
  } = useIncidentAttachmentUploads({ maxTotal: 10 });

  const uploadCount = uploads.length;

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
    setProblem("");
    setProposedSolution("");
    setManagerNotes("");
    resetUploads();
    setError(null);
  };

  const handleQueue = (files: File[]) => {
    if (!employeeProfileId) {
      setError("Select an employee before uploading attachments.");
      return;
    }
    setError(null);
    const { rejected } = queueFiles(files, employeeProfileId);
    if (rejected > 0) {
      const remaining = Math.max(0, 10 - (uploads.length + files.length - rejected));
      setError(`Only ${remaining} more file(s) can be attached (max 10).`);
    }
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
    if (problem.trim().length < 3) {
      setError("Please describe the problem (min 3 characters).");
      return;
    }
    if (proposedSolution.trim().length < 3) {
      setError("Please describe the proposed solution (min 3 characters).");
      return;
    }
    if (uploadingCount > 0) {
      setError("Wait for attachments to finish uploading before filing.");
      return;
    }
    if (errorCount > 0) {
      setError("Remove or retry the failed attachment(s) before filing.");
      return;
    }
    setSubmitting(true);
    // Server composes the signed document body from problem +
    // proposed_solution; manager_notes stays on the row but never enters
    // the document that gets hashed or shown to the employee.
    const res = await fetch("/api/management/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_profile_id: employeeProfileId,
        title,
        severity,
        category,
        occurred_at: occurredAt ? new Date(occurredAt).toISOString() : null,
        problem,
        proposed_solution: proposedSolution,
        manager_notes: managerNotes.trim() || null,
        acknowledgement_text: EMPLOYEE_ACKNOWLEDGEMENT_TEMPLATE,
        attachments: submittedAttachments,
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

          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Report sections</p>
            <p className="mt-1">
              Split into three parts. The first two are shared with the
              employee at signing time; the third stays private to
              management.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="i-problem">Problem</Label>
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                Employee sees this
              </span>
            </div>
            <Textarea
              id="i-problem"
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              rows={5}
              placeholder="Describe the problem the employee is being written up for. Stick to observable facts — dates, actions, policies referenced."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="i-solution">Proposed solution &amp; deadline</Label>
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                Employee sees this
              </span>
            </div>
            <Textarea
              id="i-solution"
              value={proposedSolution}
              onChange={(e) => setProposedSolution(e.target.value)}
              rows={5}
              placeholder="What the employee is expected to do, and by when. Include a specific deadline if there is one."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="i-notes">Manager&rsquo;s notes</Label>
              <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                Private — employee does NOT see this
              </span>
            </div>
            <Textarea
              id="i-notes"
              value={managerNotes}
              onChange={(e) => setManagerNotes(e.target.value)}
              rows={4}
              placeholder="Internal context, prior conversations, escalation thoughts. Stays with the record for HR / other managers only."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="i-attach">
                Attachments (optional) {uploadCount > 0 && (
                  <span className="text-muted-foreground font-normal">
                    — {uploadCount}/10
                  </span>
                )}
              </Label>
              {uploadCount > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadCount >= 10}
                >
                  Add more
                </Button>
              )}
            </div>
            <Input
              ref={fileInputRef}
              id="i-attach"
              type="file"
              multiple
              accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.spreadsheet,application/vnd.oasis.opendocument.presentation,application/rtf,application/zip,application/x-zip-compressed,application/x-7z-compressed,application/vnd.rar,message/rfc822,application/vnd.ms-outlook,text/*,.md,.log,.csv,.eml,.msg,.heic,.heif"
              disabled={uploadCount >= 10}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) handleQueue(files);
                e.target.value = "";
              }}
              className={uploadCount > 0 ? "hidden" : undefined}
            />
            {uploadCount > 0 && (
              <ul className="space-y-2">
                {uploads.map((u) => {
                  // FileIncidentDialog never seeds `existing` — the hook still
                  // includes it in the union so we skip defensively.
                  if (u.status === "existing") return null;
                  const image = isImageMime(u.file.type);
                  return (
                    <li
                      key={u.id}
                      className={`flex items-center gap-3 rounded-md border p-2 ${
                        u.status === "error"
                          ? "border-destructive/40 bg-destructive/5"
                          : u.status === "uploaded"
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : "bg-background"
                      }`}
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
                        {image && u.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={u.previewUrl}
                            alt={u.file.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <FileKindIcon
                            mime={u.file.type}
                            className="h-5 w-5 text-muted-foreground"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        {u.status === "uploaded" ? (
                          <a
                            href={`/api/incidents/attachments/${u.meta.path}`}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate block text-sm font-medium hover:underline"
                            title={u.file.name}
                          >
                            {u.file.name}
                          </a>
                        ) : (
                          <p className="truncate text-sm font-medium" title={u.file.name}>
                            {u.file.name}
                          </p>
                        )}
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">
                            {formatBytes(u.file.size)}
                          </span>
                          {u.status === "uploading" && (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Uploading…
                            </span>
                          )}
                          {u.status === "uploaded" && (
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" />
                              Uploaded
                            </span>
                          )}
                          {u.status === "error" && (
                            <span className="inline-flex items-center gap-1 text-destructive">
                              <XCircle className="h-3 w-3" />
                              {u.error}
                            </span>
                          )}
                        </div>
                      </div>
                      {u.status === "error" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => retryUpload(u.id, employeeProfileId)}
                        >
                          <RotateCcw className="mr-1 h-3 w-3" />
                          Retry
                        </Button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeUpload(u.id)}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label="Remove attachment"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Images, video, audio, PDF, Office &amp; OpenDoc formats, plain text, archives — pretty much anything except executables. 10 MB per file, up to 10 files.
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
              disabled={
                submitting ||
                !problem.trim() ||
                !proposedSolution.trim() ||
                uploadingCount > 0
              }
            >
              {submitting ? "Filing…" : "File & send for signature"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
