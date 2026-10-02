// Display pieces shared by the incident dialogs (file, manager, employee).

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  formatIncidentNumber,
  INCIDENT_CATEGORY_LABEL,
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_SEVERITY_VARIANT,
  INCIDENT_STATUS_LABEL,
  type IncidentCategory,
  type IncidentSeverity,
  type IncidentStatus,
} from "@/lib/incidents/types";
import { FileKindIcon, formatBytes, isImageMime } from "@/components/shared/AttachmentPreview";
import { fmtLongDateTimeUS } from "@/components/shared/format";
import { CheckCircle2, Loader2, RotateCcw, X, XCircle } from "lucide-react";
import type { UploadItem } from "./useIncidentAttachmentUploads";

// Marks whether a report section reaches the employee or stays with management.
export function VisibilityPill({ private: isPrivate = false }: { private?: boolean }) {
  return isPrivate ? (
    <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
      Private — employee does NOT see this
    </span>
  ) : (
    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
      Employee sees this
    </span>
  );
}

// Number + title, then severity / category / status badges once loaded.
export function IncidentDialogTitle({
  report,
  loading,
}: {
  report: {
    number: number | null;
    title: string;
    severity: IncidentSeverity;
    category: IncidentCategory;
    status: IncidentStatus;
  } | null;
  loading: boolean;
}) {
  return (
    <>
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
          <Badge variant={INCIDENT_SEVERITY_VARIANT[report.severity]}>
            {INCIDENT_SEVERITY_LABEL[report.severity]}
          </Badge>
          <Badge variant="outline">{INCIDENT_CATEGORY_LABEL[report.category]}</Badge>
          <Badge variant="secondary">{INCIDENT_STATUS_LABEL[report.status]}</Badge>
        </DialogDescription>
      )}
    </>
  );
}

export function SignatureBlock({
  label,
  signedAt,
  text,
  hash,
}: {
  label: string;
  signedAt: string | null;
  text: string | null;
  hash: string | null;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      {signedAt ? (
        <>
          <p className="font-medium">{text}</p>
          <p className="text-xs text-muted-foreground">{fmtLongDateTimeUS(signedAt)}</p>
          {hash && (
            <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground" title={hash}>
              SHA-256: {hash}
            </p>
          )}
        </>
      ) : (
        <p className="text-muted-foreground italic">Not yet signed</p>
      )}
    </div>
  );
}

// One row of the attachment upload queue: thumbnail, name, size, state,
// retry (on error) and remove. "new" (filing) shows the picked file's own
// name and links finished uploads; "edit" prefers the stored metadata and
// also lists attachments already on the report.
export function UploadRow({
  item,
  variant,
  onRetry,
  onRemove,
}: {
  item: UploadItem;
  variant: "new" | "edit";
  onRetry: () => void;
  onRemove: () => void;
}) {
  const edit = variant === "edit";
  const meta = item.status === "existing" || item.status === "uploaded" ? item.meta : null;
  const file = item.status === "existing" ? null : item.file;
  const { mime, filename, size } =
    file && !(edit && meta)
      ? { mime: file.type, filename: file.name, size: file.size }
      : { mime: meta!.mime, filename: meta!.filename, size: meta!.size };
  const previewSrc =
    item.status === "existing" ? `/api/incidents/attachments/${item.meta.path}` : item.previewUrl;
  return (
    <li
      className={`flex items-center gap-3 rounded-md border p-2 ${
        item.status === "error"
          ? "border-destructive/40 bg-destructive/5"
          : item.status === "uploaded"
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "bg-background"
      }`}
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
        {isImageMime(mime) && previewSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewSrc} alt={filename} className="h-full w-full object-cover" />
        ) : (
          <FileKindIcon mime={mime} className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!edit && item.status === "uploaded" ? (
          <a
            href={`/api/incidents/attachments/${item.meta.path}`}
            target="_blank"
            rel="noreferrer"
            className="truncate block text-sm font-medium hover:underline"
            title={filename}
          >
            {filename}
          </a>
        ) : (
          <p className="truncate text-sm font-medium" title={filename}>
            {filename}
          </p>
        )}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{formatBytes(size)}</span>
          {item.status === "existing" && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">Existing</span>
          )}
          {item.status === "uploading" && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Uploading…
            </span>
          )}
          {item.status === "uploaded" && (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              {edit ? "Newly uploaded" : "Uploaded"}
            </span>
          )}
          {item.status === "error" && (
            <span className="inline-flex items-center gap-1 text-destructive">
              <XCircle className="h-3 w-3" />
              {item.error}
            </span>
          )}
        </div>
      </div>
      {item.status === "error" && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RotateCcw className="mr-1 h-3 w-3" />
          Retry
        </Button>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive"
        aria-label="Remove attachment"
        title={edit ? "Remove" : undefined}
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}
