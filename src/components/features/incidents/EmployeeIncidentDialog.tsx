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
import { Paperclip, Printer, ShieldCheck } from "lucide-react";

interface EmployeeReport {
  id: string;
  title: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  status: IncidentStatus;
  occurred_at: string | null;
  document: string;
  acknowledgement_text: string;
  attachments: IncidentAttachment[] | null;
  manager_signed_at: string | null;
  manager_signature_text: string | null;
  employee_signed_at: string | null;
  employee_signature_text: string | null;
  created_at: string;
  reporter_name: string | null;
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

// Employee-facing detail dialog. Shows the manager-signed report, the
// acknowledgement text, and a signature field. Only awaiting_employee_sig
// reports can be signed here; completed reports display read-only.
export function EmployeeIncidentDialog({
  incidentId,
  open,
  onOpenChange,
  onSigned,
  employeeFullName,
}: {
  incidentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSigned: () => void;
  employeeFullName: string | null;
}) {
  const [report, setReport] = useState<EmployeeReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signatureText, setSignatureText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open || !incidentId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);
    setSignatureText("");
    setAcknowledged(false);
    fetch(`/api/incidents/${incidentId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed to load");
        return res.json();
      })
      .then((data: EmployeeReport) => {
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
    if (!acknowledged) {
      setError("Please acknowledge that you have read the report.");
      return;
    }
    if (!employeeFullName) {
      setError("Missing your name on file — contact an admin.");
      return;
    }
    const normalized = signatureText.trim().toLowerCase().replace(/\s+/g, " ");
    const expected = employeeFullName.trim().toLowerCase().replace(/\s+/g, " ");
    if (normalized !== expected) {
      setError("Type your full name exactly as it appears on your profile.");
      return;
    }
    setSigning(true);
    const res = await fetch(`/api/incidents/${report.id}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signature_text: signatureText.trim(),
        acknowledged: true,
      }),
    });
    setSigning(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Sign failed");
      return;
    }
    onSigned();
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
                <p className="text-xs text-muted-foreground">Filed by</p>
                <p className="font-medium">{report.reporter_name || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Date of incident</p>
                <p>{fmtDate(report.occurred_at)}</p>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-1">Report</p>
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
                  </>
                ) : (
                  <p className="text-muted-foreground italic">Not yet signed</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Your signature</p>
                {report.employee_signed_at ? (
                  <>
                    <p className="font-medium">{report.employee_signature_text}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(report.employee_signed_at)}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground italic">
                    Not yet signed
                  </p>
                )}
              </div>
            </div>

            {report.status === "awaiting_employee_sig" && (
              <div className="space-y-2 border-t pt-3">
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    I acknowledge that I have received and reviewed this incident
                    report. My signature confirms receipt and does not necessarily
                    indicate agreement with the contents.
                  </span>
                </label>
                <Label htmlFor="emp-sig">Type your full name to sign</Label>
                <Input
                  id="emp-sig"
                  value={signatureText}
                  onChange={(e) => setSignatureText(e.target.value)}
                  placeholder={employeeFullName || "Full name on file"}
                />
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Button>
              {report.status === "awaiting_employee_sig" && (
                <Button size="sm" onClick={sign} disabled={signing}>
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  {signing ? "Signing…" : "Sign acknowledgement"}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
