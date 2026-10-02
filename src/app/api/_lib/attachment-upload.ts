import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

// Shared plumbing for the incident / memo / time-off attachment upload
// endpoints. Each route keeps its own auth + per-feature checks; these
// helpers cover the identical form parsing, size limits, type blocklist,
// and storage write so the three stay byte-for-byte consistent.

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file

// Blocklist rather than allowlist — the ask was "wide and expansive"
// (images, video, office docs, archives, whatever a manager needs to
// attach as evidence). We only reject types that are dangerous to serve
// back to a browser as an executable payload. Everything else — including
// unusual office/media formats — goes through.
const BLOCKED_MIME = new Set([
  "application/x-msdownload", // .exe, .dll
  "application/x-msdos-program",
  "application/x-msi",
  "application/x-sh",
  "application/x-bat",
  "application/x-executable",
  "application/x-mach-binary",
]);
const BLOCKED_EXT = new Set([
  "exe", "dll", "msi", "bat", "cmd", "sh", "ps1", "vbs", "scr", "jar",
  "com", "cpl", "app", "deb", "rpm",
]);

// Multipart check + `file` field presence. Returns the parsed form so the
// caller can read any extra fields.
export async function readUploadForm(
  req: NextRequest,
): Promise<{ form: FormData; file: File } | NextResponse> {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  return { form, file };
}

export function fileSizeError(file: File): NextResponse | null {
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 413 });
  }
  return null;
}

export function fileMime(file: File): string {
  return file.type || "application/octet-stream";
}

export function blockedTypeError(file: File, mime: string): NextResponse | null {
  const ext = (file.name.match(/\.([A-Za-z0-9]+)$/)?.[1] || "").toLowerCase();
  if (BLOCKED_MIME.has(mime) || BLOCKED_EXT.has(ext)) {
    return NextResponse.json(
      { error: `File type ${mime || ext} isn't allowed for security reasons` },
      { status: 415 },
    );
  }
  return null;
}

// Store the file at `{ownerId}/{uuid}-{safeName}` and return the metadata
// the client tucks into the record's `attachments` array. `verify` runs on
// the raw bytes before the write and may veto it with its own response.
export async function storeAttachment({
  bucket,
  ownerId,
  file,
  mime,
  verify,
}: {
  bucket: string;
  ownerId: string;
  file: File;
  mime: string;
  verify?: (bytes: Uint8Array) => NextResponse | null;
}): Promise<NextResponse> {
  // Sanitize the display filename so it can't smuggle path separators or
  // ridiculous whitespace into the storage key.
  const originalName = file.name || "upload";
  const safeName = originalName
    .replace(/[\\/]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, 128) || "upload";

  const path = `${ownerId}/${randomUUID()}-${safeName}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const rejected = verify?.(bytes);
  if (rejected) return rejected;

  const { error } = await createAdminClient()
    .storage.from(bucket)
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    path,
    filename: originalName,
    size: file.size,
    mime,
  });
}
