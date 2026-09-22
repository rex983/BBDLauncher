// Shared attachment upload queue used by FileIncidentDialog (new report)
// and ManagerIncidentDialog (edit mode). Both surfaces need the same
// behaviors: per-file uploading/error/uploaded state with retry, image
// preview URL lifecycle, max-total cap, and clean unmount that revokes
// any object URLs we minted.
//
// Edit mode seeds the queue with `existing` items — attachments already
// on the report before edit began. Those items have a `meta` (server-side
// path/filename/size/mime) but no `file` since they weren't just picked.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IncidentAttachment } from "@/lib/incidents/types";

export type UploadItem =
  | { id: string; status: "existing"; meta: IncidentAttachment }
  | {
      id: string;
      status: "uploading";
      file: File;
      previewUrl: string | null;
    }
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
      meta: IncidentAttachment;
    };

function makePreviewUrl(file: File): string | null {
  if (!file.type.toLowerCase().startsWith("image/")) return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

export interface UseIncidentAttachmentUploadsResult {
  uploads: UploadItem[];
  uploadingCount: number;
  errorCount: number;
  // Attachments to submit — the union of `existing` and `uploaded` metas,
  // in insertion order.
  submittedAttachments: IncidentAttachment[];
  queueFiles: (files: File[], employeeProfileId: string) => { rejected: number };
  retryUpload: (id: string, employeeProfileId: string) => void;
  removeUpload: (id: string) => void;
  seedExisting: (attachments: IncidentAttachment[]) => void;
  reset: () => void;
}

export function useIncidentAttachmentUploads(options?: {
  maxTotal?: number;
}): UseIncidentAttachmentUploadsResult {
  const maxTotal = options?.maxTotal ?? 10;
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const uploadsRef = useRef<UploadItem[]>([]);
  uploadsRef.current = uploads;

  // Revoke minted object URLs on unmount only — mid-life removal handles
  // its own revoke inline. The eslint disable is intentional: we deliberately
  // read the latest queue via the ref so this cleanup runs exactly once.
  useEffect(() => {
    return () => {
      uploadsRef.current.forEach((u) => {
        if (u.status !== "existing" && u.previewUrl) URL.revokeObjectURL(u.previewUrl);
      });
    };
  }, []);

  const runUpload = useCallback(
    async (id: string, file: File, employeeProfileId: string) => {
      const body = new FormData();
      body.append("file", file);
      body.append("employeeProfileId", employeeProfileId);
      let res: Response;
      try {
        res = await fetch("/api/incidents/attachments", { method: "POST", body });
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
      const meta: IncidentAttachment = await res.json();
      setUploads((prev) =>
        prev.map((u) =>
          u.id === id && u.status === "uploading"
            ? { id, status: "uploaded", file: u.file, previewUrl: u.previewUrl, meta }
            : u,
        ),
      );
    },
    [],
  );

  const queueFiles = useCallback(
    (files: File[], employeeProfileId: string): { rejected: number } => {
      const remaining = Math.max(0, maxTotal - uploadsRef.current.length);
      const accepted = files.slice(0, remaining);
      const rejected = files.length - accepted.length;
      const newItems: UploadItem[] = accepted.map((file) => ({
        id: crypto.randomUUID(),
        status: "uploading" as const,
        file,
        previewUrl: makePreviewUrl(file),
      }));
      setUploads((prev) => [...prev, ...newItems]);
      newItems.forEach((item) => {
        if (item.status === "uploading") {
          runUpload(item.id, item.file, employeeProfileId);
        }
      });
      return { rejected };
    },
    [maxTotal, runUpload],
  );

  const retryUpload = useCallback(
    (id: string, employeeProfileId: string) => {
      const target = uploadsRef.current.find((u) => u.id === id);
      if (!target || target.status !== "error") return;
      setUploads((prev) =>
        prev.map((u) =>
          u.id === id && u.status === "error"
            ? { id, status: "uploading", file: u.file, previewUrl: u.previewUrl }
            : u,
        ),
      );
      runUpload(id, target.file, employeeProfileId);
    },
    [runUpload],
  );

  const removeUpload = useCallback((id: string) => {
    setUploads((prev) => {
      const gone = prev.find((u) => u.id === id);
      if (gone && gone.status !== "existing" && gone.previewUrl) {
        URL.revokeObjectURL(gone.previewUrl);
      }
      return prev.filter((u) => u.id !== id);
    });
  }, []);

  const seedExisting = useCallback((attachments: IncidentAttachment[]) => {
    setUploads((prev) => {
      prev.forEach((u) => {
        if (u.status !== "existing" && u.previewUrl) URL.revokeObjectURL(u.previewUrl);
      });
      return attachments.map((a) => ({
        id: a.path,
        status: "existing" as const,
        meta: a,
      }));
    });
  }, []);

  const reset = useCallback(() => {
    setUploads((prev) => {
      prev.forEach((u) => {
        if (u.status !== "existing" && u.previewUrl) URL.revokeObjectURL(u.previewUrl);
      });
      return [];
    });
  }, []);

  const uploadingCount = uploads.filter((u) => u.status === "uploading").length;
  const errorCount = uploads.filter((u) => u.status === "error").length;
  const submittedAttachments: IncidentAttachment[] = uploads
    .filter(
      (u): u is Extract<UploadItem, { status: "existing" | "uploaded" }> =>
        u.status === "existing" || u.status === "uploaded",
    )
    .map((u) => u.meta);

  return {
    uploads,
    uploadingCount,
    errorCount,
    submittedAttachments,
    queueFiles,
    retryUpload,
    removeUpload,
    seedExisting,
    reset,
  };
}
