"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AttachmentPreview } from "@/components/shared/AttachmentPreview";
import {
  formatMemoNumber,
  MEMO_ACK_MODE_LABEL,
  MEMO_CATEGORY_LABEL,
  MEMO_PRIORITY_LABEL,
  type MemoPriority,
} from "@/lib/memos/types";
import { CheckCircle2, Printer, ShieldCheck } from "lucide-react";
import type { EmployeeMemoPageData } from "./page";

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

const PRIORITY_VARIANT: Record<
  MemoPriority,
  "default" | "secondary" | "outline" | "destructive"
> = {
  informational: "outline",
  important: "default",
  mandatory: "destructive",
};

export function EmployeeMemoView({
  data,
  employeeFullName,
}: {
  data: EmployeeMemoPageData;
  employeeFullName: string | null;
}) {
  const router = useRouter();
  const [memo, setMemo] = useState(data);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signatureText, setSignatureText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const alreadyAcknowledged = !!memo.recipient.acknowledged_at;
  const needsSignature = memo.acknowledgement_mode === "signed";

  const acknowledge = async () => {
    setError(null);
    setSigning(true);
    const payload: Record<string, unknown> = { acknowledged: true };
    if (memo.acknowledgement_mode === "signed") {
      if (!employeeFullName) {
        setError("Missing your name on file — contact an admin.");
        setSigning(false);
        return;
      }
      const normalized = signatureText.trim().toLowerCase().replace(/\s+/g, " ");
      const expected = employeeFullName.trim().toLowerCase().replace(/\s+/g, " ");
      if (normalized !== expected) {
        setError("Type your full name exactly as it appears on your profile.");
        setSigning(false);
        return;
      }
      payload.signature_text = signatureText.trim();
    }
    const res = await fetch(`/api/memos/${memo.id}/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSigning(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Failed to acknowledge");
      return;
    }
    // Update local state so the page re-renders in "acknowledged" mode
    // without a full navigation. The router.refresh() also picks up any
    // server-side changes (audit event, etc.) so a hard refresh isn't
    // needed.
    setMemo({
      ...memo,
      recipient: {
        ...memo.recipient,
        acknowledged_at: new Date().toISOString(),
        signature_text: typeof payload.signature_text === "string" ? payload.signature_text : memo.recipient.signature_text,
      },
    });
    router.refresh();
  };

  return (
    <>
      <div className="flex items-baseline gap-3 print:mb-2">
        {memo.number != null && (
          <span className="font-mono text-sm text-muted-foreground">
            {formatMemoNumber(memo.number)}
          </span>
        )}
        <h1 className="text-3xl font-bold tracking-tight">{memo.title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Badge variant={PRIORITY_VARIANT[memo.priority]}>
          {MEMO_PRIORITY_LABEL[memo.priority]}
        </Badge>
        <Badge variant="outline">{MEMO_CATEGORY_LABEL[memo.category]}</Badge>
        <Badge variant="secondary">
          {MEMO_ACK_MODE_LABEL[memo.acknowledgement_mode]}
        </Badge>
      </div>

      <Card>
        <CardContent className="space-y-6 py-6">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b pb-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">From</p>
              <p className="font-medium">{memo.author_name || "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Published</p>
              <p>{fmtDate(memo.published_at)}</p>
            </div>
            {memo.effective_date && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Effective</p>
                <p>
                  {new Date(memo.effective_date + "T00:00:00").toLocaleDateString()}
                </p>
              </div>
            )}
            {memo.edit_count > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Edits</p>
                <p className="text-xs">Last edited {fmtDate(memo.last_edited_at)}</p>
              </div>
            )}
          </div>

          <div className="whitespace-pre-wrap text-base leading-relaxed">
            {memo.body}
          </div>

          {Array.isArray(memo.attachments) && memo.attachments.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Attachments ({memo.attachments.length})
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {memo.attachments.map((a) => (
                  <AttachmentPreview
                    key={a.path}
                    attachment={a}
                    hrefPrefix="/api/memos/attachments/"
                  />
                ))}
              </div>
            </div>
          )}

          {memo.document_hash && (
            <div className="rounded-md border bg-muted/30 p-3 print:hidden">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Document integrity
              </p>
              <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                SHA-256: {memo.document_hash}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {alreadyAcknowledged ? (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="py-4">
            <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              You acknowledged this memo on {fmtDate(memo.recipient.acknowledged_at)}.
            </p>
            {memo.recipient.signature_text && (
              <p className="mt-1 text-xs text-muted-foreground">
                Signature: {memo.recipient.signature_text}
              </p>
            )}
          </CardContent>
        </Card>
      ) : memo.acknowledgement_mode === "informational" ? (
        <p className="text-sm text-muted-foreground italic print:hidden">
          No acknowledgement required — this memo is informational.
        </p>
      ) : (
        <Card className="print:hidden">
          <CardContent className="space-y-4 py-6">
            {needsSignature ? (
              <>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    I acknowledge that I have received and reviewed this memo.
                  </span>
                </label>
                <div className="space-y-2">
                  <Label htmlFor="memo-sig">Type your full name to sign</Label>
                  <Input
                    id="memo-sig"
                    value={signatureText}
                    onChange={(e) => setSignatureText(e.target.value)}
                    placeholder={employeeFullName || "Full name on file"}
                    disabled={!acknowledged}
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Confirm you&rsquo;ve read this memo — no signature required for
                read-receipt mode.
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button
                onClick={acknowledge}
                disabled={
                  signing ||
                  (needsSignature && (!acknowledged || !signatureText.trim()))
                }
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                {signing
                  ? "Saving…"
                  : needsSignature
                    ? "Sign acknowledgement"
                    : "Mark as acknowledged"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end print:hidden">
        <Button variant="ghost" size="sm" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" />
          Print
        </Button>
      </div>
    </>
  );
}
