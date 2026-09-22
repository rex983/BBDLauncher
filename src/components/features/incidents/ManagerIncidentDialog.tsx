"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
  formatIncidentNumber,
  INCIDENT_CATEGORIES,
  INCIDENT_CATEGORY_LABEL,
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_STATUS_LABEL,
  type IncidentAttachment,
  type IncidentCategory,
  type IncidentSeverity,
  type IncidentStatus,
} from "@/lib/incidents/types";
import { isAdmin as isAdminRole } from "@/lib/auth/permissions";
import { AttachmentPreview } from "@/components/shared/AttachmentPreview";
import {
  AlertTriangle,
  Download,
  Pencil,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

export interface ManagerIncidentSummary {
  id: string;
  number: number | null;
  employee_profile_id: string;
  reporter_profile_id: string | null;
  title: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  status: IncidentStatus;
  occurred_at: string | null;
  attachments: IncidentAttachment[] | null;
  manager_signed_at: string | null;
  employee_signed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  employee?: {
    id?: string;
    email?: string;
    name?: string | null;
    office?: string | null;
    department?: string | null;
  } | null;
}

interface IncidentEvent {
  id: string;
  event_type: string;
  event_label: string;
  actor_profile_id: string | null;
  actor_ip: string | null;
  actor_ua: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  actor: { name?: string | null; email?: string } | null;
}

interface FullReport extends ManagerIncidentSummary {
  description: string;
  document: string;
  problem: string | null;
  proposed_solution: string | null;
  manager_notes: string | null;
  acknowledgement_text: string;
  manager_signature_text: string | null;
  employee_signature_text: string | null;
  document_hash: string | null;
  manager_signature_hash: string | null;
  employee_signature_hash: string | null;
  cancelled_reason: string | null;
  reporter?: { name?: string | null } | null;
  events?: IncidentEvent[];
}

const SEVERITY_VARIANT: Record<
  IncidentSeverity,
  "default" | "secondary" | "outline" | "destructive"
> = {
  low: "secondary",
  medium: "outline",
  high: "default",
  critical: "destructive",
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function fmtRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDate(iso);
}

export function ManagerIncidentDialog({
  incidentId,
  open,
  onOpenChange,
  onChanged,
  reporterFullName,
}: {
  incidentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  reporterFullName: string | null;
}) {
  const { data: session } = useSession();
  const viewerIsAdmin = isAdminRole(session?.user?.role);

  const [report, setReport] = useState<FullReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signatureText, setSignatureText] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    severity: "medium" as IncidentSeverity,
    category: "performance" as IncidentCategory,
    // Split-section fields when present, falls back to document for legacy rows.
    problem: "",
    proposed_solution: "",
    manager_notes: "",
    document: "",
  });

  const load = async (id: string) => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch(`/api/management/incidents/${id}`);
      if (!res.ok) throw new Error((await res.json()).error || "Failed to load");
      const data: FullReport = await res.json();
      setReport(data);
      setEditForm({
        title: data.title,
        severity: data.severity,
        category: data.category,
        problem: data.problem ?? "",
        proposed_solution: data.proposed_solution ?? "",
        manager_notes: data.manager_notes ?? "",
        // Legacy rows have no problem/proposed_solution — the edit form
        // will hide those two fields in that case (see below) and this
        // preserves the raw document body for editing directly.
        document: data.document,
      });
    } catch (e) {
      setError((e as Error).message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !incidentId) return;
    let cancelled = false;
    load(incidentId).then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [incidentId, open]);

  useEffect(() => {
    if (!open) {
      setEditing(false);
      setError(null);
      setSignatureText("");
    }
  }, [open]);

  const sign = async () => {
    if (!report) return;
    setError(null);
    if (!reporterFullName) {
      setError("Missing your name on file — contact an admin.");
      return;
    }
    const normalized = signatureText.trim().toLowerCase().replace(/\s+/g, " ");
    const expected = reporterFullName.trim().toLowerCase().replace(/\s+/g, " ");
    if (normalized !== expected) {
      setError("Type your full name exactly as it appears on your profile.");
      return;
    }
    setSigning(true);
    const res = await fetch(`/api/management/incidents/${report.id}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature_text: signatureText.trim() }),
    });
    setSigning(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Sign failed");
      return;
    }
    onChanged();
    onOpenChange(false);
  };

  const cancel = async () => {
    if (!report) return;
    const reason = window.prompt(
      "Optional reason for cancelling (audit only, employee won't see this):",
      "",
    );
    if (reason === null) return;
    if (!confirm("Cancel this incident report? The row is preserved for audit.")) return;
    setCancelling(true);
    const url = new URL(`/api/management/incidents/${report.id}`, window.location.origin);
    if (reason.trim()) url.searchParams.set("reason", reason.trim());
    const res = await fetch(url.toString(), { method: "DELETE" });
    setCancelling(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Cancel failed");
      return;
    }
    onChanged();
    onOpenChange(false);
  };

  const save = async () => {
    if (!report) return;
    setError(null);
    if (!editForm.title.trim()) {
      setError("Title is required.");
      return;
    }
    const hasSections = report.problem !== null || report.proposed_solution !== null;
    if (hasSections) {
      if (editForm.problem.trim().length < 3) {
        setError("Problem must be at least 3 characters.");
        return;
      }
      if (editForm.proposed_solution.trim().length < 3) {
        setError("Proposed solution must be at least 3 characters.");
        return;
      }
    } else if (editForm.document.trim().length < 10) {
      setError("Report body must be at least 10 characters.");
      return;
    }
    setSaving(true);

    // Only send fields that actually changed. For split-section rows, send
    // problem/proposed_solution/manager_notes and let the server recompose
    // document. For legacy rows, send document verbatim.
    const patchBody: Record<string, unknown> = {};
    if (editForm.title !== report.title) patchBody.title = editForm.title;
    if (editForm.severity !== report.severity) patchBody.severity = editForm.severity;
    if (editForm.category !== report.category) patchBody.category = editForm.category;
    if (hasSections) {
      if (editForm.problem !== (report.problem ?? "")) patchBody.problem = editForm.problem;
      if (editForm.proposed_solution !== (report.proposed_solution ?? "")) {
        patchBody.proposed_solution = editForm.proposed_solution;
      }
      const trimmedNotes = editForm.manager_notes.trim();
      if (trimmedNotes !== (report.manager_notes ?? "")) {
        patchBody.manager_notes = trimmedNotes || null;
      }
    } else if (editForm.document !== report.document) {
      patchBody.document = editForm.document;
    }

    const res = await fetch(`/api/management/incidents/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    });
    setSaving(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Save failed");
      return;
    }
    setEditing(false);
    // Reload to pick up any admin-override reset (signatures, status).
    await load(report.id);
    onChanged();
  };

  const hasSignatures =
    report && (report.manager_signed_at !== null || report.employee_signed_at !== null);
  const isSignedOrCompleted =
    report &&
    (report.status === "awaiting_employee_sig" || report.status === "completed");
  const canEdit =
    report &&
    report.status !== "cancelled" &&
    (viewerIsAdmin ||
      report.status === "draft" ||
      report.status === "awaiting_manager_sig");
  const canDelete =
    report && report.status !== "cancelled" && (viewerIsAdmin || report.status !== "completed");
  const isAdminEditingSigned = editing && isSignedOrCompleted;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-baseline gap-2">
            {report?.number != null && (
              <span className="font-mono text-sm text-muted-foreground">
                {formatIncidentNumber(report.number)}
              </span>
            )}
            <span>{report?.title || (loading ? "Loading…" : "Incident report")}</span>
          </DialogTitle>
          {report && (
            <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
              <Badge variant={SEVERITY_VARIANT[report.severity]}>
                {INCIDENT_SEVERITY_LABEL[report.severity]}
              </Badge>
              <Badge variant="outline">
                {INCIDENT_CATEGORY_LABEL[report.category]}
              </Badge>
              <Badge variant="secondary">
                {INCIDENT_STATUS_LABEL[report.status]}
              </Badge>
            </DialogDescription>
          )}
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && !report && <p className="text-sm text-destructive">{error}</p>}

        {report && (
          <div className="space-y-4 text-sm">
            {isAdminEditingSigned && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Admin override — signed document</p>
                    <p className="text-xs text-muted-foreground">
                      Editing a signed report invalidates every existing
                      signature. Saving will reset the report to
                      &quot;awaiting manager signature&quot; and require both
                      parties to sign again. This action is logged.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Employee</p>
                <p className="font-medium">{report.employee?.name || "Unknown"}</p>
                <p className="text-xs text-muted-foreground">{report.employee?.email || ""}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Reporter</p>
                <p className="font-medium">{report.reporter?.name || "Unknown"}</p>
                <p className="text-xs text-muted-foreground">
                  Filed {fmtDate(report.created_at)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Occurred</p>
                <p>{fmtDate(report.occurred_at)}</p>
              </div>
            </div>

            {editing ? (
              <div className="space-y-3 rounded-md border p-3">
                <div className="space-y-2">
                  <Label htmlFor="edit-title">Title</Label>
                  <Input
                    id="edit-title"
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="edit-severity">Severity</Label>
                    <Select
                      value={editForm.severity}
                      onValueChange={(v) =>
                        setEditForm({ ...editForm, severity: v as IncidentSeverity })
                      }
                    >
                      <SelectTrigger id="edit-severity">
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
                    <Label htmlFor="edit-category">Category</Label>
                    <Select
                      value={editForm.category}
                      onValueChange={(v) =>
                        setEditForm({ ...editForm, category: v as IncidentCategory })
                      }
                    >
                      <SelectTrigger id="edit-category">
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
                {report.problem !== null || report.proposed_solution !== null ? (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="edit-problem">Problem</Label>
                        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                          Employee sees this
                        </span>
                      </div>
                      <Textarea
                        id="edit-problem"
                        value={editForm.problem}
                        onChange={(e) => setEditForm({ ...editForm, problem: e.target.value })}
                        rows={5}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="edit-solution">Proposed solution &amp; deadline</Label>
                        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                          Employee sees this
                        </span>
                      </div>
                      <Textarea
                        id="edit-solution"
                        value={editForm.proposed_solution}
                        onChange={(e) => setEditForm({ ...editForm, proposed_solution: e.target.value })}
                        rows={5}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="edit-notes">Manager&rsquo;s notes</Label>
                        <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                          Private — employee does NOT see this
                        </span>
                      </div>
                      <Textarea
                        id="edit-notes"
                        value={editForm.manager_notes}
                        onChange={(e) => setEditForm({ ...editForm, manager_notes: e.target.value })}
                        rows={4}
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="edit-doc">Report body</Label>
                    <Textarea
                      id="edit-doc"
                      value={editForm.document}
                      onChange={(e) => setEditForm({ ...editForm, document: e.target.value })}
                      rows={14}
                      className="font-mono text-sm"
                    />
                  </div>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(false);
                      setError(null);
                      setEditForm({
                        title: report.title,
                        severity: report.severity,
                        category: report.category,
                        problem: report.problem ?? "",
                        proposed_solution: report.proposed_solution ?? "",
                        manager_notes: report.manager_notes ?? "",
                        document: report.document,
                      });
                    }}
                    disabled={saving}
                  >
                    <X className="mr-2 h-4 w-4" />
                    Cancel edit
                  </Button>
                  <Button size="sm" onClick={save} disabled={saving}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            ) : report.problem !== null || report.proposed_solution !== null ? (
              <>
                {report.problem && (
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">
                        Problem
                      </p>
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                        Employee sees this
                      </span>
                    </div>
                    <div className="rounded-md border bg-background p-4 whitespace-pre-wrap text-sm leading-relaxed">
                      {report.problem}
                    </div>
                  </div>
                )}
                {report.proposed_solution && (
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">
                        Proposed solution &amp; deadline
                      </p>
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                        Employee sees this
                      </span>
                    </div>
                    <div className="rounded-md border bg-background p-4 whitespace-pre-wrap text-sm leading-relaxed">
                      {report.proposed_solution}
                    </div>
                  </div>
                )}
                {report.manager_notes && (
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">
                        Manager&rsquo;s notes
                      </p>
                      <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                        Private — employee does NOT see this
                      </span>
                    </div>
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 whitespace-pre-wrap text-sm leading-relaxed">
                      {report.manager_notes}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Report body</p>
                <div className="rounded-md border bg-background p-4 whitespace-pre-wrap font-mono text-xs leading-relaxed">
                  {report.document}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs text-muted-foreground mb-1">Acknowledgement</p>
              <div className="rounded-md border bg-muted/30 p-3 whitespace-pre-wrap text-xs">
                {report.acknowledgement_text}
              </div>
            </div>

            {Array.isArray(report.attachments) && report.attachments.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">
                  Attachments ({report.attachments.length})
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {report.attachments.map((a) => (
                    <AttachmentPreview
                      key={a.path}
                      attachment={a}
                      hrefPrefix="/api/incidents/attachments/"
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 border-t pt-3">
              <div>
                <p className="text-xs text-muted-foreground">Manager signature</p>
                {report.manager_signed_at ? (
                  <>
                    <p className="font-medium">{report.manager_signature_text}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(report.manager_signed_at)}
                    </p>
                    {report.manager_signature_hash && (
                      <p
                        className="mt-1 break-all font-mono text-[10px] text-muted-foreground"
                        title={report.manager_signature_hash}
                      >
                        SHA-256: {report.manager_signature_hash}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground italic">Not yet signed</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Employee signature</p>
                {report.employee_signed_at ? (
                  <>
                    <p className="font-medium">{report.employee_signature_text}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(report.employee_signed_at)}
                    </p>
                    {report.employee_signature_hash && (
                      <p
                        className="mt-1 break-all font-mono text-[10px] text-muted-foreground"
                        title={report.employee_signature_hash}
                      >
                        SHA-256: {report.employee_signature_hash}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground italic">Not yet signed</p>
                )}
              </div>
            </div>

            {report.document_hash && (
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Document integrity
                </p>
                <p
                  className="mt-1 break-all font-mono text-[10px] text-muted-foreground"
                  title={report.document_hash}
                >
                  SHA-256: {report.document_hash}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Hash of the report body captured at manager-sign time. Any
                  edit after signing would break the chain.
                </p>
              </div>
            )}

            {report.status === "cancelled" && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-xs text-muted-foreground">Cancelled {fmtDate(report.cancelled_at)}</p>
                {report.cancelled_reason && (
                  <p className="text-sm mt-1">{report.cancelled_reason}</p>
                )}
              </div>
            )}

            {report.status === "awaiting_manager_sig" && !editing && (
              <div className="space-y-2 border-t pt-3">
                <Label htmlFor="mgr-sig">Type your full name to sign</Label>
                <Input
                  id="mgr-sig"
                  value={signatureText}
                  onChange={(e) => setSignatureText(e.target.value)}
                  placeholder={reporterFullName || "Full name on file"}
                />
                <p className="text-xs text-muted-foreground">
                  Signing locks the document body. The employee will be
                  notified to countersign.
                </p>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            )}

            <div className="border-t pt-3">
              <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                Activity
              </p>
              {!report.events || report.events.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No activity recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {report.events.map((ev) => {
                    const isOverride =
                      ev.event_type === "admin_override_edit" ||
                      ev.event_type === "admin_override_delete";
                    return (
                      <li key={ev.id} className="flex items-start gap-2 text-xs">
                        <span
                          className={`mt-0.5 h-2 w-2 flex-shrink-0 rounded-full ${
                            isOverride ? "bg-amber-500" : "bg-muted-foreground/50"
                          }`}
                          aria-hidden
                        />
                        <div className="flex-1">
                          <p
                            className={`font-medium ${
                              isOverride ? "text-amber-700 dark:text-amber-400" : ""
                            }`}
                          >
                            {ev.event_label}
                          </p>
                          <p className="text-muted-foreground">
                            {ev.actor?.name || ev.actor?.email || "System"} ·{" "}
                            <span title={fmtDate(ev.created_at)}>
                              {fmtRelative(ev.created_at)}
                            </span>
                            {ev.actor_ip && (
                              <>
                                {" · "}
                                <span className="font-mono text-[10px]">{ev.actor_ip}</span>
                              </>
                            )}
                          </p>
                          {ev.details && ev.event_type === "edited" && (
                            <EditDetails details={ev.details} />
                          )}
                          {ev.details && ev.event_type === "admin_override_edit" && (
                            <EditDetails details={ev.details} />
                          )}
                          {ev.details && (ev.event_type === "cancelled" || ev.event_type === "admin_override_delete") && (
                            <CancelDetails details={ev.details} />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`/api/incidents/${report.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </a>
              </Button>
              {canEdit && !editing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setEditing(true);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                  {hasSignatures && viewerIsAdmin && (
                    <span className="ml-1 text-xs text-amber-600">(override)</span>
                  )}
                </Button>
              )}
              {canDelete && !editing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cancel}
                  disabled={cancelling}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {cancelling ? "Cancelling…" : "Cancel report"}
                </Button>
              )}
              {report.status === "awaiting_manager_sig" && !editing && (
                <Button size="sm" onClick={sign} disabled={signing}>
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  {signing ? "Processing…" : "Process & send to employee"}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditDetails({ details }: { details: Record<string, unknown> }) {
  const changes = details.changes as
    | { field: string; from: unknown; to: unknown }[]
    | undefined;
  if (!changes || changes.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
      {changes.map((c) => (
        <li key={c.field}>
          <span className="font-medium">{c.field}</span>{" "}
          changed
        </li>
      ))}
    </ul>
  );
}

function CancelDetails({ details }: { details: Record<string, unknown> }) {
  const reason = typeof details.reason === "string" ? details.reason : null;
  if (!reason) return null;
  return (
    <p className="mt-1 text-[11px] italic text-muted-foreground">
      &ldquo;{reason}&rdquo;
    </p>
  );
}
