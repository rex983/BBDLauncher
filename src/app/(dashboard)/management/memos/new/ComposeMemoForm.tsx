"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  MEMO_ACK_MODES,
  MEMO_AUDIENCE_SCOPES,
  MEMO_CATEGORIES,
  MEMO_PRIORITIES,
  type MemoAcknowledgementMode,
  type MemoAttachment,
  type MemoAudienceScope,
  type MemoCategory,
  type MemoPriority,
} from "@/lib/memos/types";
import {
  FileKindIcon,
  formatBytes,
  isImageMime,
} from "@/components/shared/AttachmentPreview";
import {
  CheckCircle2,
  Loader2,
  RotateCcw,
  Users,
  X,
  XCircle,
} from "lucide-react";

const VALID_OFFICES = ["Harbor", "Marion", "BST", "RnD"] as const;
const VALID_DEPARTMENTS = ["SALES TEAM", "BST", "RnD"] as const;

type UploadItem =
  | { id: string; status: "uploading"; file: File; previewUrl: string | null }
  | {
      id: string;
      status: "error";
      file: File;
      previewUrl: string | null;
      error: string;
    }
  | {
      id: string;
      status: "uploaded";
      file: File;
      previewUrl: string | null;
      meta: MemoAttachment;
    };

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

interface AudiencePreview {
  count: number;
  audience_label: string;
  recipients: EmployeeOption[];
}

function makePreviewUrl(file: File): string | null {
  if (!file.type.toLowerCase().startsWith("image/")) return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

export function ComposeMemoForm({
  viewerRole,
  viewerOffice,
  viewerDepartment,
}: {
  viewerRole: string;
  viewerOffice: string | null;
  viewerDepartment: string | null;
}) {
  const router = useRouter();
  const isAdmin = viewerRole === "admin";
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<MemoCategory>("announcement");
  const [priority, setPriority] = useState<MemoPriority>("informational");
  const [ackMode, setAckMode] =
    useState<MemoAcknowledgementMode>("read_receipt");

  const defaultScope: MemoAudienceScope = isAdmin
    ? "company"
    : viewerDepartment
      ? "department"
      : "office";
  const [audienceScope, setAudienceScope] =
    useState<MemoAudienceScope>(defaultScope);
  const [audienceOffice, setAudienceOffice] = useState<string | null>(
    isAdmin ? null : viewerOffice,
  );
  const [audienceDepartment, setAudienceDepartment] = useState<string | null>(
    isAdmin ? null : viewerDepartment,
  );
  const [customIds, setCustomIds] = useState<string[]>([]);

  const [effectiveDate, setEffectiveDate] = useState("");
  const [publishMode, setPublishMode] = useState<"now" | "draft">("now");

  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    return () => {
      uploads.forEach((u) => u.previewUrl && URL.revokeObjectURL(u.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch employee roster when custom scope is active.
  useEffect(() => {
    if (audienceScope !== "custom") return;
    let cancelled = false;
    (async () => {
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
    })();
    return () => {
      cancelled = true;
    };
  }, [audienceScope]);

  const runUpload = useCallback(async (id: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    let res: Response;
    try {
      res = await fetch("/api/memos/attachments", { method: "POST", body });
    } catch {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === id && u.status === "uploading"
            ? { ...u, status: "error", error: "Network error" }
            : u,
        ),
      );
      return;
    }
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      const msg = typeof b.error === "string" ? b.error : "Upload failed";
      setUploads((prev) =>
        prev.map((u) =>
          u.id === id && u.status === "uploading"
            ? { ...u, status: "error", error: msg }
            : u,
        ),
      );
      return;
    }
    const meta: MemoAttachment = await res.json();
    setUploads((prev) =>
      prev.map((u) =>
        u.id === id && u.status === "uploading"
          ? {
              id,
              status: "uploaded",
              file: u.file,
              previewUrl: u.previewUrl,
              meta,
            }
          : u,
      ),
    );
  }, []);

  const queueFiles = (files: File[]) => {
    setError(null);
    const remaining = Math.max(0, 20 - uploads.length);
    const accepted = files.slice(0, remaining);
    if (files.length > accepted.length) {
      setError(`Only ${remaining} more file(s) can be attached (max 20).`);
    }
    const newItems: UploadItem[] = accepted.map((file) => ({
      id: crypto.randomUUID(),
      status: "uploading" as const,
      file,
      previewUrl: makePreviewUrl(file),
    }));
    setUploads((prev) => [...prev, ...newItems]);
    newItems.forEach((item) => runUpload(item.id, item.file));
  };

  const retryUpload = (id: string) => {
    const target = uploads.find((u) => u.id === id);
    if (!target || target.status !== "error") return;
    setUploads((prev) =>
      prev.map((u) =>
        u.id === id && u.status === "error"
          ? { id: u.id, status: "uploading", file: u.file, previewUrl: u.previewUrl }
          : u,
      ),
    );
    runUpload(id, target.file);
  };

  const removeUpload = (id: string) => {
    setUploads((prev) => {
      const gone = prev.find((u) => u.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((u) => u.id !== id);
    });
  };

  const previewAudience = async () => {
    setPreviewing(true);
    setError(null);
    const res = await fetch("/api/management/memos/audience-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audience_scope: audienceScope,
        audience_office: audienceOffice,
        audience_department: audienceDepartment,
        custom_profile_ids: customIds,
      }),
    });
    setPreviewing(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Preview failed");
      return;
    }
    setPreview(await res.json());
  };

  const uploadCount = uploads.length;
  const uploadingCount = uploads.filter((u) => u.status === "uploading").length;
  const attachments: MemoAttachment[] = uploads
    .filter((u): u is Extract<UploadItem, { status: "uploaded" }> => u.status === "uploaded")
    .map((u) => u.meta);

  const submit = async () => {
    setError(null);
    if (!title.trim()) return setError("Please enter a title.");
    if (body.trim().length < 3) return setError("Memo body is too short.");
    if (uploadingCount > 0) return setError("Wait for attachments to finish uploading.");
    if (uploads.some((u) => u.status === "error"))
      return setError("Remove or retry the failed attachment(s) before submitting.");
    if (audienceScope === "office" && !audienceOffice)
      return setError("Pick an office.");
    if (audienceScope === "department" && !audienceDepartment)
      return setError("Pick a department.");
    if (audienceScope === "custom" && customIds.length === 0)
      return setError("Pick at least one recipient.");
    if (audienceScope === "custom" && publishMode !== "now")
      return setError("Custom-audience memos must be published on save.");

    setSubmitting(true);
    const res = await fetch("/api/management/memos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        body: body.trim(),
        category,
        priority,
        acknowledgement_mode: ackMode,
        audience_scope: audienceScope,
        audience_office:
          audienceScope === "office" || audienceScope === "department"
            ? audienceOffice
            : null,
        audience_department:
          audienceScope === "department" ? audienceDepartment : null,
        custom_profile_ids: audienceScope === "custom" ? customIds : undefined,
        effective_date: effectiveDate || null,
        publish_immediately: publishMode === "now",
        attachments,
      }),
    });
    if (!res.ok) {
      setSubmitting(false);
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Failed to save memo.");
      return;
    }
    const created: { id: string } = await res.json();
    // Navigate to the newly-created memo detail so the manager sees the
    // final result (recipient roster, hash chain, etc.). Drafts land on
    // the same detail page in draft state.
    router.push(`/management/memos/${created.id}`);
  };

  const submitLabel = submitting
    ? "Saving…"
    : publishMode === "now"
      ? "Publish memo"
      : "Save as draft";

  return (
    <Card>
      <CardContent className="space-y-6 py-6">
        <div className="space-y-2">
          <Label htmlFor="m-title">Title</Label>
          <Input
            id="m-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Updated PTO policy — effective Oct 1"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="m-category">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as MemoCategory)}
            >
              <SelectTrigger id="m-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMO_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-priority">Priority</Label>
            <Select
              value={priority}
              onValueChange={(v) => setPriority(v as MemoPriority)}
            >
              <SelectTrigger id="m-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMO_PRIORITIES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="m-ack">Acknowledgement</Label>
          <Select
            value={ackMode}
            onValueChange={(v) => setAckMode(v as MemoAcknowledgementMode)}
          >
            <SelectTrigger id="m-ack">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMO_ACK_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {MEMO_ACK_MODES.find((m) => m.value === ackMode)?.hint}
          </p>
        </div>

        <div className="space-y-2">
          <Label>Audience</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {MEMO_AUDIENCE_SCOPES.map((s) => {
              const disabled =
                !isAdmin &&
                (s.value === "company" ||
                  (s.value === "office" && !viewerOffice) ||
                  (s.value === "department" && !viewerDepartment));
              return (
                <label
                  key={s.value}
                  className={`flex items-start gap-2 rounded-md border p-2 text-sm cursor-pointer ${
                    audienceScope === s.value
                      ? "border-foreground/50 bg-muted/50"
                      : "hover:bg-muted/30"
                  } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <input
                    type="radio"
                    name="audience-scope"
                    value={s.value}
                    checked={audienceScope === s.value}
                    onChange={() => setAudienceScope(s.value)}
                    disabled={disabled}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium">{s.label}</p>
                    <p className="text-xs text-muted-foreground">{s.hint}</p>
                  </div>
                </label>
              );
            })}
          </div>

          {(audienceScope === "office" || audienceScope === "department") && (
            <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="m-office">Office</Label>
                <Select
                  value={audienceOffice ?? ""}
                  onValueChange={(v) => setAudienceOffice(v || null)}
                  disabled={!isAdmin}
                >
                  <SelectTrigger id="m-office">
                    <SelectValue placeholder="Pick an office" />
                  </SelectTrigger>
                  <SelectContent>
                    {VALID_OFFICES.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {audienceScope === "department" && (
                <div className="space-y-2">
                  <Label htmlFor="m-dept">Department</Label>
                  <Select
                    value={audienceDepartment ?? ""}
                    onValueChange={(v) => setAudienceDepartment(v || null)}
                    disabled={!isAdmin}
                  >
                    <SelectTrigger id="m-dept">
                      <SelectValue placeholder="Pick a department" />
                    </SelectTrigger>
                    <SelectContent>
                      {VALID_DEPARTMENTS.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {audienceScope === "custom" && (
            <div className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">
                Pick which employees receive this memo ({customIds.length}{" "}
                selected).
              </p>
              <div className="max-h-64 overflow-y-auto rounded-md border p-2 space-y-1">
                {employees.map((e) => (
                  <label
                    key={e.id}
                    className="flex items-center gap-2 text-sm hover:bg-muted/30 rounded px-1"
                  >
                    <input
                      type="checkbox"
                      checked={customIds.includes(e.id)}
                      onChange={(ev) => {
                        if (ev.target.checked) {
                          setCustomIds((prev) => [...prev, e.id]);
                        } else {
                          setCustomIds((prev) => prev.filter((id) => id !== e.id));
                        }
                      }}
                    />
                    <span className="flex-1">{e.name || e.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {e.office || ""}
                    </span>
                  </label>
                ))}
                {employees.length === 0 && (
                  <p className="text-xs text-muted-foreground p-2">
                    Loading employees…
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={previewAudience}
              disabled={previewing}
            >
              <Users className="mr-2 h-4 w-4" />
              {previewing ? "Loading…" : "Preview audience"}
            </Button>
            {preview && (
              <span className="text-xs text-muted-foreground">
                {preview.audience_label} · {preview.count} recipient
                {preview.count === 1 ? "" : "s"}
              </span>
            )}
          </div>
          {preview && preview.recipients.length > 0 && preview.recipients.length <= 30 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {preview.recipients.map((r) => (
                <Badge key={r.id} variant="outline" className="text-xs">
                  {r.name || r.email}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="m-body">Memo body</Label>
          <Textarea
            id="m-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            placeholder="Write or paste the memo contents. Formatting is preserved as plain text."
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="m-effective">Effective date (optional)</Label>
            <Input
              id="m-effective"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Publish</Label>
            <div className="flex flex-wrap gap-1">
              {(["now", "draft"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPublishMode(mode)}
                  className={`rounded-md border px-3 py-1 text-xs ${
                    publishMode === mode
                      ? "border-foreground/50 bg-foreground text-background"
                      : "hover:bg-muted/40"
                  }`}
                >
                  {mode === "now" ? "Publish now" : "Save as draft"}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Drafts can be reviewed and published later from the memo detail
              page.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="m-attach">
              Attachments (optional)
              {uploadCount > 0 && (
                <span className="text-muted-foreground font-normal">
                  {" "}
                  — {uploadCount}/20
                </span>
              )}
            </Label>
            {uploadCount > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadCount >= 20}
              >
                Add more
              </Button>
            )}
          </div>
          <Input
            ref={fileInputRef}
            id="m-attach"
            type="file"
            multiple
            disabled={uploadCount >= 20}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) queueFiles(files);
              e.target.value = "";
            }}
            className={uploadCount > 0 ? "hidden" : undefined}
          />
          {uploadCount > 0 && (
            <ul className="space-y-2">
              {uploads.map((u) => {
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
                          href={`/api/memos/attachments/${u.meta.path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate block text-sm font-medium hover:underline"
                        >
                          {u.file.name}
                        </a>
                      ) : (
                        <p className="truncate text-sm font-medium">
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
                        onClick={() => retryUpload(u.id)}
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
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/management/memos")}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={
              submitting || uploadingCount > 0 || !title.trim() || body.trim().length < 3
            }
          >
            {submitLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
