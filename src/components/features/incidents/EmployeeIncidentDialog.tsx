"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  IncidentAttachment,
  IncidentCategory,
  IncidentSeverity,
  IncidentStatus,
} from "@/lib/incidents/types";
import { AttachmentPreview } from "@/components/shared/AttachmentPreview";
import { fmtLongDateTimeUS as fmtDate } from "@/components/shared/format";
import { IncidentDialogTitle, SignatureBlock } from "./incident-parts";
import { Download, ShieldCheck } from "lucide-react";

interface EmployeeReport {
  id: string;
  number: number | null;
  title: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  status: IncidentStatus;
  occurred_at: string | null;
  document: string;
  problem: string | null;
  proposed_solution: string | null;
  acknowledgement_text: string;
  attachments: IncidentAttachment[] | null;
  manager_signed_at: string | null;
  manager_signature_text: string | null;
  employee_signed_at: string | null;
  employee_signature_text: string | null;
  document_hash: string | null;
  manager_signature_hash: string | null;
  employee_signature_hash: string | null;
  created_at: string;
  reporter_name: string | null;
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
          <IncidentDialogTitle report={report} loading={loading} />
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

            {report.problem || report.proposed_solution ? (
              <>
                {report.problem && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                      Problem
                    </p>
                    <div className="rounded-md border bg-background p-4 whitespace-pre-wrap text-sm leading-relaxed">
                      {report.problem}
                    </div>
                  </div>
                )}
                {report.proposed_solution && (
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                      Proposed solution &amp; deadline
                    </p>
                    <div className="rounded-md border bg-background p-4 whitespace-pre-wrap text-sm leading-relaxed">
                      {report.proposed_solution}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Report</p>
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
              <SignatureBlock
                label="Manager signature"
                signedAt={report.manager_signed_at}
                text={report.manager_signature_text}
                hash={report.manager_signature_hash}
              />
              <SignatureBlock
                label="Your signature"
                signedAt={report.employee_signed_at}
                text={report.employee_signature_text}
                hash={report.employee_signature_hash}
              />
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
                  This hash proves the report body hasn&apos;t changed since
                  the manager signed. If the body were edited, this hash
                  would no longer match.
                </p>
              </div>
            )}

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
              <Button
                variant="outline"
                size="sm"
                asChild
              >
                <a
                  href={`/api/incidents/${report.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </a>
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
