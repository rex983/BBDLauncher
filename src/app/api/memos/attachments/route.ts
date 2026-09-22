import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canEditTimeData } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const BUCKET = "office-memo-attachments";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file — same as incidents

// Same blocklist as incident attachments — reject executables only.
const BLOCKED_MIME = new Set([
  "application/x-msdownload",
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

// POST /api/memos/attachments — upload a memo attachment. Only authors
// (manager-tier / admin) can upload. Files land in the private
// `office-memo-attachments` bucket keyed by the author's profile id:
// `{authorProfileId}/{uuid}-{safeName}`.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canEditTimeData(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 413 });
  }
  const mime = file.type || "application/octet-stream";
  const ext = (file.name.match(/\.([A-Za-z0-9]+)$/)?.[1] || "").toLowerCase();
  if (BLOCKED_MIME.has(mime) || BLOCKED_EXT.has(ext)) {
    return NextResponse.json(
      { error: `File type ${mime || ext} isn't allowed for security reasons` },
      { status: 415 },
    );
  }

  const supabase = createAdminClient();

  const originalName = file.name || "upload";
  const safeName = originalName
    .replace(/[\\/]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, 128) || "upload";

  const path = `${session.user.profileId}/${randomUUID()}-${safeName}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error } = await supabase.storage
    .from(BUCKET)
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
