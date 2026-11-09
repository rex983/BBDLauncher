import { NextRequest, NextResponse } from "next/server";
import {
  blockedTypeError,
  fileMime,
  fileSizeError,
  readUploadForm,
  storeAttachment,
} from "@/app/api/_lib/attachment-upload";
import { getRequest, ONBOARDING_BUCKET, requireOnboardingUser } from "@/lib/onboarding/service";

// POST /api/onboarding/[id]/documents — one file per call into the private
// onboarding-docs bucket at {id}/{uuid}-{name}. Deleted with the request.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOnboardingUser();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  if (!(await getRequest(session, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const upload = await readUploadForm(req);
  if (upload instanceof NextResponse) return upload;
  const { file } = upload;
  const sizeErr = fileSizeError(file);
  if (sizeErr) return sizeErr;
  const mime = fileMime(file);
  const typeErr = blockedTypeError(file, mime);
  if (typeErr) return typeErr;

  return storeAttachment({ bucket: ONBOARDING_BUCKET, ownerId: id, file, mime });
}
