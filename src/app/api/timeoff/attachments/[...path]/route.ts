import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, timeDataScope, isAdmin } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";

const BUCKET = "time-off-attachments";

// Resolve `time-off-attachments/{profileId}/{uuid}-{filename}` to a short-
// lived signed URL and redirect. Access is either "you own it" or "you're
// a manager scoped to that profile" (same rules as the rest of the time
// data stack). Admins see everything.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  if (!path || path.length < 2) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  const [ownerId, ...rest] = path;
  const objectPath = [ownerId, ...rest].join("/");

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The owner can always fetch their own attachments.
  const viewerId = session.user.profileId;
  let allowed = viewerId === ownerId;

  if (!allowed) {
    // Managers with time-data access to the owner's dept + office get in.
    // Admins skip the scope check entirely.
    if (!canViewTimeData(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const scope = timeDataScope(session.user.role, session.user.department);
    if (!scope.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = createAdminClient();
    const { data: owner } = await supabase
      .from("profiles")
      .select("department, office, is_active")
      .eq("id", ownerId)
      .single();
    if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!isAdmin(session.user.role)) {
      if (owner.is_active === false) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (scope.department && owner.department !== scope.department) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (scope.office && owner.office !== scope.office) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    allowed = true;
  }

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, 60); // 60s is plenty for a redirect.
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message || "Not found" }, { status: 404 });
  }
  return NextResponse.redirect(data.signedUrl, 302);
}
