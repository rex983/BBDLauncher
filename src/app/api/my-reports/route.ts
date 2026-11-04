import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { groupReports } from "@/lib/rep-insights";
import { canViewAs } from "@/lib/launcher/view-as";
import { resolvePermRole } from "@/lib/auth/perm-role";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/types/auth";

// The signed-in person's team report (teams they lead) and office report
// (when they manage), from Rep Insights, for their profile and the clock-in
// screen. Nobody else gets an empty list. ?as=<profile id>: View as, that
// person's (when the viewer may View as them). ?date=: look back.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.profileId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const as = q.get("as");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get("date") ?? "") ? q.get("date")! : undefined;
  let who = {
    profileId: session.user.profileId,
    permRole: (session.user.permRole as string | undefined) ?? null,
    office: (session.user.office as string | null | undefined) ?? null,
    department: (session.user.department as string | null | undefined) ?? null,
  };
  if (as && as !== session.user.profileId) {
    if ((await canViewAs(session.user.profileId, as)) !== true) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { data } = await createAdminClient().from("profiles").select("role, office, department").eq("id", as).single();
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    who = {
      profileId: as,
      permRole: await resolvePermRole(data.role as UserRole),
      office: (data.office as string | null) ?? null,
      department: (data.department as string | null) ?? null,
    };
  }
  const { status, body } = await groupReports(who, date);
  return NextResponse.json(body, { status });
}
