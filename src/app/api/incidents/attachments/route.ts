import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import {
  canEditTimeData,
  isAdmin,
  timeDataScope,
} from "@/lib/auth/permissions";
import { isTargetInScope, type ScopedProfile } from "@/lib/auth/scope-check";
import {
  blockedTypeError,
  fileMime,
  fileSizeError,
  readUploadForm,
  storeAttachment,
} from "@/app/api/_lib/attachment-upload";
import { NextRequest, NextResponse } from "next/server";

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
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  if (!canEditTimeData(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const upload = await readUploadForm(req);
  if (upload instanceof NextResponse) return upload;
  const { form, file } = upload;
  const employeeProfileId = form.get("employeeProfileId");
  if (typeof employeeProfileId !== "string" || !employeeProfileId) {
    return NextResponse.json({ error: "Missing employeeProfileId" }, { status: 400 });
  }
  const sizeErr = fileSizeError(file);
  if (sizeErr) return sizeErr;
  const mime = fileMime(file);
  const typeErr = blockedTypeError(file, mime);
  if (typeErr) return typeErr;

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
    const { data: target } = await createAdminClient()
      .from("profiles")
      .select("department, office, is_active")
      .eq("id", employeeProfileId)
      .single<ScopedProfile>();
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!isTargetInScope(scope, target)) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
  }

  return storeAttachment({
    bucket: "incident-attachments",
    ownerId: employeeProfileId,
    file,
    mime,
  });
}
