import {
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileText,
  FileVideo,
} from "lucide-react";

// Shared attachment metadata — same shape used by both incident_reports
// and office_memos. Kept structural so either module's typed attachment
// can be passed in without a cast.
export interface AttachmentMeta {
  path: string;
  filename: string;
  size: number;
  mime: string;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith("image/");
}

export function FileKindIcon({
  mime,
  className,
}: {
  mime: string;
  className?: string;
}) {
  const m = mime.toLowerCase();
  const cls = className ?? "h-6 w-6";
  if (m.startsWith("video/")) return <FileVideo className={cls} />;
  if (m.startsWith("audio/")) return <FileAudio className={cls} />;
  if (
    m === "application/pdf" ||
    m.startsWith("text/") ||
    m.includes("word") ||
    m.includes("excel") ||
    m.includes("spreadsheet") ||
    m.includes("presentation") ||
    m.includes("opendocument")
  )
    return <FileText className={cls} />;
  if (
    m.includes("zip") ||
    m.includes("rar") ||
    m.includes("7z") ||
    m.includes("compressed") ||
    m.includes("archive")
  )
    return <FileArchive className={cls} />;
  return <FileIcon className={cls} />;
}

// View-mode preview for an attachment. Renders an inline image thumbnail
// for image mimes and a file-kind icon otherwise. The whole card is a
// link to the signed-URL endpoint at `hrefPrefix + attachment.path` —
// opens in a new tab so the user can view or save the original file.
export function AttachmentPreview({
  attachment,
  hrefPrefix,
}: {
  attachment: AttachmentMeta;
  hrefPrefix: string;
}) {
  const url = `${hrefPrefix}${attachment.path}`;
  const image = isImageMime(attachment.mime);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-3 rounded-md border bg-background p-2 hover:border-foreground/50 hover:bg-muted/40 hover:shadow-sm transition-all"
      title={`Open ${attachment.filename}`}
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={attachment.filename}
            className="h-full w-full object-cover"
          />
        ) : (
          <FileKindIcon mime={attachment.mime} className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium group-hover:underline">
          {attachment.filename}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatBytes(attachment.size)} · Click to view
        </p>
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
    </a>
  );
}
