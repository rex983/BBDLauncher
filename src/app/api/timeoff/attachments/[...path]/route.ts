import { signedAttachmentRedirect } from "@/lib/attachments/signed-redirect";
import type { NextRequest } from "next/server";

// Signed-URL redirect for `time-off-attachments/{ownerProfileId}/…` — see
// signedAttachmentRedirect for the access rules.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  return signedAttachmentRedirect("time-off-attachments", path);
}
