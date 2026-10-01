import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth/permissions";
import { deactivateLauncherAccount, exportLauncherData } from "@/lib/offboarding/actions";
import { logOffboardingEvent } from "@/lib/offboarding/audit";
import { requireOpenCase } from "@/lib/offboarding/guard";
import { requireOffboarder } from "@/lib/offboarding/service";

const schema = z.object({
  action: z.enum(["deactivate_launcher", "export_launcher_data"]),
});

// Runs a built-in action and marks its task done, recording who ran it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  const { id } = await params;

  const open = await requireOpenCase(id);
  if (open instanceof NextResponse) return open;
  if (!open.profile_id) {
    return NextResponse.json({ error: "The employee's launcher profile no longer exists." }, { status: 410 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { action } = parsed.data;
  const supabase = createAdminClient();

  let eventType: string;
  let details: Record<string, unknown>;
  if (action === "deactivate_launcher") {
    // Mirrors /api/users/[id]: only admins can deactivate an admin.
    const { data: target } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", open.profile_id)
      .maybeSingle();
    if (isAdmin(target?.role) && !isAdmin(session.user.role)) {
      return NextResponse.json({ error: "Only admins can deactivate an admin account." }, { status: 403 });
    }
    const result = await deactivateLauncherAccount(open.profile_id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    eventType = "launcher_deactivated";
    details = { clocked_out: result.clockedOut };
  } else {
    const result = await exportLauncherData({
      caseId: id,
      profileId: open.profile_id,
      exportedBy: session.user.name || session.user.email,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    eventType = "data_exported";
    details = { file: result.path, counts: result.counts };
  }

  const { data: task } = await supabase
    .from("offboarding_tasks")
    .update({
      status: "done",
      completed_by: session.user.profileId,
      completed_at: new Date().toISOString(),
      ...(action === "export_launcher_data" ? { note: `Saved to ${details.file}` } : {}),
    })
    .eq("case_id", id)
    .eq("auto_action", action)
    .select("id")
    .maybeSingle();

  await logOffboardingEvent({ caseId: id, taskId: task?.id ?? null, eventType, session, req, details });
  return NextResponse.json({ ok: true, ...details });
}
