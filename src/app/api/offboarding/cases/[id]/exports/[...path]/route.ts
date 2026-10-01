import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logOffboardingEvent } from "@/lib/offboarding/audit";
import { EXPORT_BUCKET, requireOffboarder } from "@/lib/offboarding/service";

// Downloads a launcher-records backup. Every download is logged on the
// case so the trail shows who pulled personal data and when.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const { id, path } = await params;

  // Files live at {caseId}/{name}; refuse anything that tries to reach
  // another case's folder.
  if (path.length !== 1 || path[0].includes("..")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  const objectPath = `${id}/${path[0]}`;

  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(EXPORT_BUCKET)
    .createSignedUrl(objectPath, 60, { download: path[0] });
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message || "Not found" }, { status: 404 });
  }

  await logOffboardingEvent({
    caseId: id,
    eventType: "export_downloaded",
    session,
    req,
    details: { file: objectPath },
  });
  return NextResponse.redirect(data.signedUrl, 302);
}
