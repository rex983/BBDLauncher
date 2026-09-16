import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const BUCKET = "time-off-attachments";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

// Upload a single supporting document for a time-off request. Files land
// in the private `time-off-attachments` bucket at `{profileId}/{uuid}-{name}`,
// and the returned metadata is what the client tucks into the request's
// `attachments` array when it POSTs to /api/timeoff.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const profileId = session.user.profileId;

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
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json(
      { error: `File type ${mime} not allowed` },
      { status: 415 },
    );
  }

  // Sanitize the display filename so it can't smuggle path separators or
  // ridiculous whitespace into the storage key.
  const originalName = file.name || "upload";
  const safeName = originalName
    .replace(/[\\/]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, 128) || "upload";

  const path = `${profileId}/${randomUUID()}-${safeName}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const supabase = createAdminClient();
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
