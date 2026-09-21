import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canEditTimeData,
  isAdmin,
  timeDataScope,
} from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const BUCKET = "incident-attachments";
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

// Upload a single supporting document for an incident report. Only managers
// (with scope over the employee) or admins can upload. Files land in the
// private `incident-attachments` bucket at `{employeeProfileId}/{uuid}-{name}`,
// and the returned metadata is what the client tucks into the report's
// `attachments` array when it POSTs /api/management/incidents.
//
// Path is keyed by the employee (subject) not the manager (uploader) so the
// download endpoint can enforce access with the same scope check the rest of
// the time-data stack uses.
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
  const employeeProfileId = form.get("employeeProfileId");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (typeof employeeProfileId !== "string" || !employeeProfileId) {
    return NextResponse.json({ error: "Missing employeeProfileId" }, { status: 400 });
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

  // Scope check: is the manager allowed to touch this employee's file?
  // Admins bypass, same as everywhere else in the time-data stack.
  if (!isAdmin(session.user.role)) {
    const scope = timeDataScope(
      session.user.role,
      session.user.department,
      session.user.office,
    );
    if (!scope.allowed) {
      return NextResponse.json({ error: "No scope" }, { status: 403 });
    }
    const { data: target } = await supabase
      .from("profiles")
      .select("department, office, is_active")
      .eq("id", employeeProfileId)
      .single();
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (target.is_active === false) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
    if (scope.department && target.department !== scope.department) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
    if (scope.office && target.office !== scope.office) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
  }

  const originalName = file.name || "upload";
  const safeName = originalName
    .replace(/[\\/]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, 128) || "upload";

  const path = `${employeeProfileId}/${randomUUID()}-${safeName}`;
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
