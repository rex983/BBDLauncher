"use client";

import { useState } from "react";
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
import { AlertTriangle, Paperclip, Sparkles, X } from "lucide-react";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export interface FileIncidentDialogProps {
  employeeProfileId: string;
  employeeName: string;
  trigger?: React.ReactNode;
  onFiled?: () => void;
}

// AI-assisted incident report creation. Manager describes what happened, the
// LLM drafts the formal write-up, manager edits if needed, submits — which
// creates the row already flagged awaiting_manager_sig. Manager then signs
// from the detail dialog. Two-step because generation shouldn't persist a
// half-baked draft; regeneration is free.
export function FileIncidentDialog({
  employeeProfileId,
  employeeName,
  trigger,
  onFiled,
}: FileIncidentDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [category, setCategory] = useState<IncidentCategory>("performance");
  const [occurredAt, setOccurredAt] = useState<string>("");
  const [description, setDescription] = useState("");
  const [document, setDocument] = useState("");
  const [aiMeta, setAiMeta] = useState<{
    provider: string;
    model: string;
    prompt: string;
    original: string;
  } | null>(null);
  const [attachments, setAttachments] = useState<IncidentAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setSeverity("medium");
    setCategory("performance");
    setOccurredAt("");
    setDescription("");
    setDocument("");
    setAiMeta(null);
    setAttachments([]);
    setError(null);
  };

  const uploadFile = async (file: File) => {
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

  const generate = async () => {
    setError(null);
    if (!title.trim() || description.trim().length < 10) {
      setError("Please fill in a title and a description (10+ characters).");
      return;
    }
    setGenerating(true);
    const res = await fetch("/api/management/incidents/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_profile_id: employeeProfileId,
        title,
        severity,
        category,
        occurred_at: occurredAt ? new Date(occurredAt).toISOString() : null,
        description,
      }),
    });
    setGenerating(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Generation failed");
      return;
    }
    const body = (await res.json()) as {
      document: string;
      provider: string;
      model: string;
      prompt: string;
    };
    setDocument(body.document);
    setAiMeta({
      provider: body.provider,
      model: body.model,
      prompt: body.prompt,
      original: body.document,
    });
  };

  const submit = async () => {
    setError(null);
    if (!document.trim() || document.trim().length < 10) {
      setError("The report body is empty — generate or paste one first.");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/management/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_profile_id: employeeProfileId,
        title,
        severity,
        category,
        occurred_at: occurredAt ? new Date(occurredAt).toISOString() : null,
        description,
        document,
        acknowledgement_text: EMPLOYEE_ACKNOWLEDGEMENT_TEMPLATE,
        ai_provider: aiMeta?.provider ?? null,
        ai_model: aiMeta?.model ?? null,
        ai_prompt: aiMeta?.prompt ?? null,
        ai_generated_document: aiMeta?.original ?? null,
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
          <DialogTitle>File incident report — {employeeName}</DialogTitle>
          <DialogDescription>
            Describe what happened, let the AI draft a formal write-up, review and edit it, then send for signatures.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
            <Label htmlFor="i-occurred">Date &amp; time of incident (optional)</Label>
            <Input
              id="i-occurred"
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="i-desc">Describe what happened</Label>
            <Textarea
              id="i-desc"
              value={description}
              rows={5}
              placeholder="Plain language is fine — mention who, what, when, where, and any policy/expectation involved. The AI turns this into a formal write-up."
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Only facts you provide are included. The AI won&apos;t invent
              details.
            </p>
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
          </div>

          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">AI-drafted report</p>
                {aiMeta && (
                  <p className="text-xs text-muted-foreground">
                    {aiMeta.provider} · {aiMeta.model}
                  </p>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                variant={document ? "outline" : "default"}
                onClick={generate}
                disabled={generating}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {generating
                  ? "Drafting…"
                  : document
                    ? "Regenerate"
                    : "Draft with AI"}
              </Button>
            </div>
            <Textarea
              value={document}
              onChange={(e) => setDocument(e.target.value)}
              rows={14}
              placeholder="The AI-generated report will appear here. You can edit it before sending."
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Edits are always allowed before the report is signed. Once you
              sign, the document is locked.
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
