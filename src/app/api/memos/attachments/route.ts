import { requireSession } from "@/lib/auth/require-session";
import { canEditTimeData } from "@/lib/auth/permissions";
import {
  blockedTypeError,
  fileMime,
  fileSizeError,
  readUploadForm,
  storeAttachment,
} from "@/app/api/_lib/attachment-upload";
import { NextRequest, NextResponse } from "next/server";

// POST /api/memos/attachments — upload a memo attachment. Only authors
// (manager-tier / admin) can upload. Files land in the private
// `office-memo-attachments` bucket keyed by the author's profile id:
// `{authorProfileId}/{uuid}-{safeName}`. Same executable blocklist as
// incident attachments.
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  if (!canEditTimeData(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const upload = await readUploadForm(req);
  if (upload instanceof NextResponse) return upload;
  const { file } = upload;
  const sizeErr = fileSizeError(file);
  if (sizeErr) return sizeErr;
  const mime = fileMime(file);
  const typeErr = blockedTypeError(file, mime);
  if (typeErr) return typeErr;

  return storeAttachment({
    bucket: "office-memo-attachments",
    ownerId: session.user.profileId,
    file,
    mime,
  });
}
