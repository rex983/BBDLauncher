"use client";

import { useEffect, useState } from "react";
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
  INCIDENT_CATEGORY_LABEL,
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_STATUS_LABEL,
  type IncidentAttachment,
  type IncidentCategory,
  type IncidentSeverity,
  type IncidentStatus,
} from "@/lib/incidents/types";
import { Paperclip, Printer, ShieldCheck, Trash2 } from "lucide-react";

export interface ManagerIncidentSummary {
  id: string;
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

interface FullReport extends ManagerIncidentSummary {
  description: string;
  document: string;
  acknowledgement_text: string;
  manager_signature_text: string | null;
  employee_signature_text: string | null;
  document_hash: string | null;
  manager_signature_hash: string | null;
  employee_signature_hash: string | null;
  cancelled_reason: string | null;
  reporter?: { name?: string | null } | null;
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

// Manager-facing detail dialog. Shows the whole report + attachments +
// signature blocks, and offers the "Sign" action when the report is
// awaiting_manager_sig. Kept as one dialog rather than a nested modal so
// the manager doesn't lose their place.
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
  // The current viewer's own full_name — used to validate the typed signature
  // client-side before hitting the server (matches the server rule).
  reporterFullName: string | null;
}) {
  const [report, setReport] = useState<FullReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signatureText, setSignatureText] = useState("");
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!open || !incidentId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);
    fetch(`/api/management/incidents/${incidentId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed to load");
        return res.json();
      })
      .then((data: FullReport) => {
        if (cancelled) return;
        setReport(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [incidentId, open]);

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
    if (reason === null) return; // user hit Cancel on the prompt
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {report?.title || (loading ? "Loading…" : "Incident report")}
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

            <div>
              <p className="text-xs text-muted-foreground mb-1">Report body</p>
              <div className="rounded-md border bg-background p-4 whitespace-pre-wrap font-mono text-xs leading-relaxed">
                {report.document}
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-1">Acknowledgement</p>
              <div className="rounded-md border bg-muted/30 p-3 whitespace-pre-wrap text-xs">
                {report.acknowledgement_text}
              </div>
            </div>

            {Array.isArray(report.attachments) && report.attachments.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Attachments</p>
                <ul className="space-y-1">
                  {report.attachments.map((a) => (
                    <li key={a.path}>
                      <a
                        href={`/api/incidents/attachments/${a.path}`}
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

            {report.status === "awaiting_manager_sig" && (
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

            <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Button>
              {(report.status === "awaiting_manager_sig" ||
                report.status === "awaiting_employee_sig" ||
                report.status === "draft") && (
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
              {report.status === "awaiting_manager_sig" && (
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
