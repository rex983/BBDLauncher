import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, timeDataScope, isAdmin } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";

const BUCKET = "incident-attachments";

// Resolve `incident-attachments/{employeeProfileId}/{uuid}-{filename}` to a
// short-lived signed URL and redirect. Access rules: the subject employee can
// always see their own attachments, and any manager with scope over that
// employee can too. Admins bypass. Same shape as /api/timeoff/attachments/...
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  if (!path || path.length < 2) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  const [employeeId, ...rest] = path;
  const objectPath = [employeeId, ...rest].join("/");

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const viewerId = session.user.profileId;
  let allowed = viewerId === employeeId;

  if (!allowed) {
    if (!canViewTimeData(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const scope = timeDataScope(
      session.user.role,
      session.user.department,
      session.user.office,
    );
    if (!scope.allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = createAdminClient();
    const { data: owner } = await supabase
      .from("profiles")
      .select("department, office, is_active")
      .eq("id", employeeId)
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
    .createSignedUrl(objectPath, 60);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message || "Not found" }, { status: 404 });
  }
  return NextResponse.redirect(data.signedUrl, 302);
}
