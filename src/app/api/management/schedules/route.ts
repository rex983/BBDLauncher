import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, canEditTimeData, timeDataScope } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Default schedule when no override exists: Mon-Fri 10:00-18:00 ET.
export const DEFAULT_SCHEDULE = { start_time: "10:00", end_time: "18:00", timezone: "America/New_York" };

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

export async function GET() {
  const session = await auth();
  if (!session?.user || !canViewTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const scope = timeDataScope(session.user.role, session.user.office);
  if (!scope.allowed) return NextResponse.json({ error: "No scope" }, { status: 403 });

  const supabase = createAdminClient();
  let profileQuery = supabase
    .from("profiles")
    .select("id, email, name:full_name, office")
    .order("email");
  if (scope.office) profileQuery = profileQuery.eq("office", scope.office);

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
  const session = await auth();
  if (!session?.user || !canEditTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const scope = timeDataScope(session.user.role, session.user.office);
  if (!scope.allowed) return NextResponse.json({ error: "No scope" }, { status: 403 });

  const parsed = upsertSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  if (scope.office) {
    const { data: target } = await supabase
      .from("profiles").select("office").eq("id", parsed.data.profile_id).single();
    if (!target || target.office !== scope.office) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
  }

  const { data, error } = await supabase
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
  const session = await auth();
  if (!session?.user || !canEditTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const scope = timeDataScope(session.user.role, session.user.office);
  if (!scope.allowed) return NextResponse.json({ error: "No scope" }, { status: 403 });

  const parsed = deleteSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  if (scope.office) {
    const { data: target } = await supabase
      .from("profiles").select("office").eq("id", parsed.data.profile_id).single();
    if (!target || target.office !== scope.office) {
      return NextResponse.json({ error: "Out of scope" }, { status: 403 });
    }
  }

  const { error } = await supabase
    .from("work_schedules")
    .delete()
    .eq("profile_id", parsed.data.profile_id)
    .eq("weekday", parsed.data.weekday);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
