import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const upsertSchema = z.object({
  profile_id: z.string().uuid(),
  weekday: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  timezone: z.string().optional(),
});

const deleteSchema = z.object({
  profile_id: z.string().uuid(),
  weekday: z.number().int().min(0).max(6),
});

export async function GET(req: NextRequest) {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) return gate.response;
  const { supabase, scope } = gate;

  // Admin-only overlay filters. Managers already have office/dept baked into
  // scope; letting them pass ?office= wouldn't grant more (scope.office wins)
  // but rejecting the branch keeps the intent obvious.
  const officeFilter = req.nextUrl.searchParams.get("office");
  const departmentFilter = req.nextUrl.searchParams.get("department");

  let profileQuery = supabase
    .from("profiles")
    .select("id, email, name:full_name, office, department")
    .eq("is_active", true)
    .order("email");
  if (scope.department) {
    profileQuery = profileQuery.eq("department", scope.department);
  } else if (departmentFilter) {
    profileQuery = profileQuery.eq("department", departmentFilter);
  }
  if (scope.office) {
    profileQuery = profileQuery.eq("office", scope.office);
  } else if (officeFilter) {
    profileQuery = profileQuery.eq("office", officeFilter);
  }

  const { data: profiles, error: pErr } = await profileQuery;
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const profileIds = (profiles || []).map((p) => p.id);
  const { data: schedules } = profileIds.length
    ? await supabase
        .from("work_schedules")
        .select("profile_id, weekday, start_time, end_time, timezone")
        .in("profile_id", profileIds)
    : { data: [] };

  return NextResponse.json({ profiles: profiles || [], schedules: schedules || [] });
}

export async function POST(req: NextRequest) {
  const parsed = upsertSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const gate = await requireTimeDataAccess(parsed.data.profile_id, "edit");
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase
    .from("work_schedules")
    .upsert(
      {
        profile_id: parsed.data.profile_id,
        weekday: parsed.data.weekday,
        start_time: parsed.data.start_time,
        end_time: parsed.data.end_time,
        timezone: parsed.data.timezone ?? "America/New_York",
      },
      { onConflict: "profile_id,weekday" },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const parsed = deleteSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const gate = await requireTimeDataAccess(parsed.data.profile_id, "edit");
  if (!gate.ok) return gate.response;

  const { error } = await gate.supabase
    .from("work_schedules")
    .delete()
    .eq("profile_id", parsed.data.profile_id)
    .eq("weekday", parsed.data.weekday);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
