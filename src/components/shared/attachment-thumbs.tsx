"use client";

import { useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileKindIcon, formatBytes, isImageMime } from "@/components/shared/AttachmentPreview";

// Uploaded files as thumbnails. Clicking one opens it in a popup on the same
// page: images and PDFs are shown, anything a browser can't display (Word,
// HEIC outside Safari) gets a download button instead.

interface AttachmentMeta {
  path: string;
  filename: string;
  size: number;
  mime: string;
}

const isPdf = (mime: string) => mime.toLowerCase() === "application/pdf";

function extension(filename: string): string {
  const ext = filename.match(/\.([A-Za-z0-9]{1,5})$/)?.[1];
  return ext ? ext.toUpperCase() : "FILE";
}

function Thumb({ attachment, url, size }: { attachment: AttachmentMeta; url: string; size: number }) {
  const [broken, setBroken] = useState(false);
  if (isImageMime(attachment.mime) && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, already small on screen
      <img
        src={url}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <span className="flex flex-col items-center gap-0.5 text-muted-foreground">
      <FileKindIcon mime={attachment.mime} className={size >= 56 ? "h-6 w-6" : "h-4 w-4"} />
      <span className="text-[10px] font-medium leading-none">{extension(attachment.filename)}</span>
    </span>
  );
}

function Viewer({ attachment, url }: { attachment: AttachmentMeta; url: string }) {
  const [broken, setBroken] = useState(false);
  if (isImageMime(attachment.mime) && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, shown at its own size
      <img
        src={url}
        alt={attachment.filename}
        onError={() => setBroken(true)}
        className="mx-auto max-h-[72vh] max-w-full rounded object-contain"
      />
    );
  }
  if (isPdf(attachment.mime)) {
    return <iframe src={`${url}?inline=1`} title={attachment.filename} className="h-[72vh] w-full rounded border bg-white" />;
  }
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <FileKindIcon mime={attachment.mime} className="h-12 w-12 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">This kind of file can&apos;t be shown here. Download it to open it.</p>
    </div>
  );
}

export function AttachmentThumbs({
  attachments,
  hrefPrefix,
  size = 56,
  onRemove,
}: {
  attachments: AttachmentMeta[];
  /** The download route the storage path is appended to, e.g. "/api/timeoff/attachments/". */
  hrefPrefix: string;
  size?: number;
  /** Shows a remove button on each thumbnail (the upload form). */
  onRemove?: (path: string) => void;
}) {
  const [open, setOpen] = useState<AttachmentMeta | null>(null);
  if (attachments.length === 0) return null;
  const urlOf = (a: AttachmentMeta) => `${hrefPrefix}${a.path}`;

  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {attachments.map((a) => (
          <li key={a.path} className="relative">
            <button
              type="button"
              onClick={() => setOpen(a)}
              title={`${a.filename} (${formatBytes(a.size)})`}
              aria-label={`Open ${a.filename}`}
              className="flex items-center justify-center overflow-hidden rounded-md border bg-muted transition-colors hover:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ width: size, height: size }}
            >
              <Thumb attachment={a} url={urlOf(a)} size={size} />
            </button>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(a.path)}
                aria-label={`Remove ${a.filename}`}
                title="Remove"
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle className="truncate pr-8">{open.filename}</DialogTitle>
                <DialogDescription>{formatBytes(open.size)}</DialogDescription>
              </DialogHeader>
              <Viewer attachment={open} url={urlOf(open)} />
              <div className="flex justify-end">
                <Button asChild variant="outline" size="sm">
                  <a href={urlOf(open)} target="_blank" rel="noreferrer" download={open.filename}>
                    <Download className="h-4 w-4" />
                    Download
                  </a>
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
