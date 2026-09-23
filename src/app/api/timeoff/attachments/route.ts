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

// Verify the file's leading bytes match the claimed MIME. The browser sets
// `file.type` from the OS extension mapping and can be trivially spoofed by
// renaming a file — without a sniff, a malicious upload can store an HTML
// or script payload under a mislabeled content type.
function magicBytesMatch(bytes: Uint8Array, mime: string): boolean {
  const startsWith = (sig: number[], offset = 0) =>
    sig.every((v, i) => bytes[offset + i] === v);
  const asciiAt = (offset: number, length: number) => {
    let s = "";
    for (let i = 0; i < length; i++) {
      const c = bytes[offset + i];
      if (c === undefined) return "";
      s += String.fromCharCode(c);
    }
    return s;
  };

  switch (mime) {
    case "application/pdf":
      return startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case "image/png":
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith([0xff, 0xd8, 0xff]);
    case "image/heic":
      // ISO BMFF container: `ftyp` box at offset 4, brand at offset 8.
      return asciiAt(4, 4) === "ftyp" &&
        ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis", "hevm", "hevs"]
          .includes(asciiAt(8, 4));
    case "image/webp":
      return asciiAt(0, 4) === "RIFF" && asciiAt(8, 4) === "WEBP";
    case "application/msword":
      // Legacy OLE2 compound document.
      return startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      // DOCX is a ZIP; the inner Content_Types.xml would need unzipping to
      // fully validate. ZIP signature is a reasonable minimum.
      return startsWith([0x50, 0x4b, 0x03, 0x04]);
    case "text/plain": {
      const head = asciiAt(0, Math.min(512, bytes.length)).toLowerCase().trimStart();
      // Refuse active-content markers a downstream consumer might render.
      if (
        head.startsWith("<!doctype html") ||
        head.startsWith("<html") ||
        head.startsWith("<?xml") ||
        head.startsWith("<script") ||
        head.startsWith("<svg")
      ) return false;
      // NUL bytes in the first 512 → binary masquerading as text.
      for (let i = 0; i < Math.min(512, bytes.length); i++) {
        if (bytes[i] === 0) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

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

  if (!magicBytesMatch(bytes, mime)) {
    return NextResponse.json(
      { error: `File contents do not match declared type ${mime}` },
      { status: 415 },
    );
  }

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
