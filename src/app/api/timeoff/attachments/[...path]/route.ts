import { signedAttachmentRedirect } from "@/lib/attachments/signed-redirect";
import type { NextRequest } from "next/server";

// Signed-URL redirect for `time-off-attachments/{ownerProfileId}/…` — see
// signedAttachmentRedirect for the access rules. `?inline=1` serves a PDF
// from here for the in-page viewer (next.config.ts lets that one be framed).
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  return signedAttachmentRedirect("time-off-attachments", path, {
    inline: req.nextUrl.searchParams.get("inline") === "1",
  });
}
