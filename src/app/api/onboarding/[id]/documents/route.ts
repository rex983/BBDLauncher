import { NextRequest, NextResponse } from "next/server";
import {
  blockedTypeError,
  fileMime,
  fileSizeError,
  readUploadForm,
  storeAttachment,
} from "@/app/api/_lib/attachment-upload";
import { closedError, getRequest, ONBOARDING_BUCKET, requireOnboardingUser } from "@/lib/onboarding/service";

// POST /api/onboarding/[id]/documents — one file per call into the private
// onboarding-docs bucket at {id}/{uuid}-{name}. Kept when the request
// closes; deleted with it ("Delete now").
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOnboardingUser();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const current = await getRequest(session, id);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const closed = closedError(current);
  if (closed) return closed;

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
