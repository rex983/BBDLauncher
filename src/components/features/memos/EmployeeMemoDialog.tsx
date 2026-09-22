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
import { AttachmentPreview } from "@/components/shared/AttachmentPreview";
import {
  formatMemoNumber,
  MEMO_ACK_MODE_LABEL,
  MEMO_CATEGORY_LABEL,
  MEMO_PRIORITY_LABEL,
  type MemoAcknowledgementMode,
  type MemoAttachment,
  type MemoCategory,
  type MemoPriority,
} from "@/lib/memos/types";
import { CheckCircle2, Printer, ShieldCheck } from "lucide-react";

interface EmployeeMemo {
  id: string;
  number: number | null;
  title: string;
  body: string;
  category: MemoCategory;
  priority: MemoPriority;
  acknowledgement_mode: MemoAcknowledgementMode;
  effective_date: string | null;
  published_at: string | null;
  attachments: MemoAttachment[] | null;
  author_name: string | null;
  document_hash: string | null;
  author_signature_hash: string | null;
  edit_count: number;
  last_edited_at: string | null;
  recipient: {
    id: string;
    delivered_at: string;
    read_at: string | null;
    acknowledged_at: string | null;
    signature_text: string | null;
  };
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
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

// Employee-facing memo dialog. Shows the memo body + attachments + author,
// stamps `read_at` on open via the GET endpoint, and offers a signature
// UI when acknowledgement_mode is 'signed'. Informational + read_receipt
// modes get a simple "Mark as acknowledged" button that just closes the
// bell notification.
export function EmployeeMemoDialog({
  memoId,
  open,
  onOpenChange,
  onAcknowledged,
  employeeFullName,
}: {
  memoId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAcknowledged: () => void;
  employeeFullName: string | null;
}) {
  const [memo, setMemo] = useState<EmployeeMemo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signatureText, setSignatureText] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open || !memoId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMemo(null);
    setSignatureText("");
    setAcknowledged(false);
    fetch(`/api/memos/${memoId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed to load");
        return res.json();
      })
      .then((data: EmployeeMemo) => {
        if (cancelled) return;
        setMemo(data);
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
  }, [memoId, open]);

  const acknowledge = async () => {
    if (!memo) return;
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
    onAcknowledged();
    onOpenChange(false);
  };

  const alreadyAcknowledged = !!memo?.recipient.acknowledged_at;
  const needsSignature = memo?.acknowledgement_mode === "signed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-baseline gap-2">
            {memo?.number != null && (
              <span className="font-mono text-sm text-muted-foreground">
                {formatMemoNumber(memo.number)}
              </span>
            )}
            <span>{memo?.title || (loading ? "Loading…" : "Memo")}</span>
          </DialogTitle>
          {memo && (
            <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
              <Badge variant={PRIORITY_VARIANT[memo.priority]}>
                {MEMO_PRIORITY_LABEL[memo.priority]}
              </Badge>
              <Badge variant="outline">
                {MEMO_CATEGORY_LABEL[memo.category]}
              </Badge>
              <Badge variant="secondary">
                {MEMO_ACK_MODE_LABEL[memo.acknowledgement_mode]}
              </Badge>
            </DialogDescription>
          )}
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && !memo && <p className="text-sm text-destructive">{error}</p>}

        {memo && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">From</p>
                <p className="font-medium">{memo.author_name || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Published</p>
                <p>{fmtDate(memo.published_at)}</p>
              </div>
              {memo.effective_date && (
                <div>
                  <p className="text-xs text-muted-foreground">Effective date</p>
                  <p>
                    {new Date(memo.effective_date + "T00:00:00").toLocaleDateString()}
                  </p>
                </div>
              )}
              {memo.edit_count > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">Edits</p>
                  <p>
                    Last edited {fmtDate(memo.last_edited_at)}
                  </p>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Memo
              </p>
              <div className="rounded-md border bg-background p-4 whitespace-pre-wrap text-sm leading-relaxed">
                {memo.body}
              </div>
            </div>

            {Array.isArray(memo.attachments) && memo.attachments.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">
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
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Document integrity
                </p>
                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                  SHA-256: {memo.document_hash}
                </p>
              </div>
            )}

            {alreadyAcknowledged ? (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
                <p className="font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  You acknowledged this memo on{" "}
                  {fmtDate(memo.recipient.acknowledged_at)}.
                </p>
                {memo.recipient.signature_text && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Signature: {memo.recipient.signature_text}
                  </p>
                )}
              </div>
            ) : memo.acknowledgement_mode === "informational" ? (
              <p className="text-xs text-muted-foreground italic">
                No acknowledgement required — this memo is informational.
              </p>
            ) : (
              <div className="space-y-2 border-t pt-3">
                {needsSignature && (
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
                    <Label htmlFor="memo-sig">Type your full name to sign</Label>
                    <Input
                      id="memo-sig"
                      value={signatureText}
                      onChange={(e) => setSignatureText(e.target.value)}
                      placeholder={employeeFullName || "Full name on file"}
                      disabled={!acknowledged}
                    />
                  </>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
              <Button variant="ghost" size="sm" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Button>
              {!alreadyAcknowledged &&
                memo.acknowledgement_mode !== "informational" && (
                  <Button
                    size="sm"
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
                )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
