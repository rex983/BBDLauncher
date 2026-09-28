import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import {
  isTargetInScope,
  resolveTimeDataScope,
  type ScopedProfile,
} from "@/lib/auth/scope-check";
import { NextResponse } from "next/server";

// Resolve `{bucket}/{ownerProfileId}/{uuid}-{filename}` to a short-lived
// signed URL and redirect. The owner can always fetch their own files; any
// manager with time-data scope over the owner (active, same dept + office)
// can too. Admins skip the scope check. Every denial is a bare "Forbidden".
export async function signedAttachmentRedirect(
  bucket: string,
  path: string[] | undefined,
): Promise<NextResponse> {
  if (!path || path.length < 2) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  const [ownerId] = path;

  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const supabase = createAdminClient();

  if (session.user.profileId !== ownerId) {
    const forbidden = NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const access = resolveTimeDataScope(session.user, "view");
    if (!access.ok) return forbidden;

    const { data: owner } = await supabase
      .from("profiles")
      .select("department, office, is_active")
      .eq("id", ownerId)
      .single<ScopedProfile>();
    if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!access.viewerIsAdmin && !isTargetInScope(access.scope, owner)) return forbidden;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path.join("/"), 60); // 60s is plenty for a redirect.
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message || "Not found" }, { status: 404 });
  }
  return NextResponse.redirect(data.signedUrl, 302);
}
