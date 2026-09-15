import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  localDateInZone,
  scheduledTimeInZone,
  weekdayInZone,
} from "@/lib/timesheets/tz";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  minutes: z.number().int().positive().max(480), // 8h cap
});

// Employee accepted the T-5 prompt and picked how much longer to work.
// The extension is stacked onto the effective end (schedule or previous
// extension), NOT onto "now" — so accepting the prompt at 5:56pm for
// "another 15 min" pushes end from 6:00 → 6:15, not 6:11.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const now = new Date();
  const weekday = weekdayInZone(now);
  const localDate = localDateInZone(now);

  // Compute today's effective end = max(scheduled end, existing extension).
  const [scheduleRes, extensionRes] = await Promise.all([
    supabase
      .from("work_schedules")
      .select("end_time")
      .eq("profile_id", session.user.profileId)
      .eq("weekday", weekday)
      .maybeSingle(),
    supabase
      .from("time_extensions")
      .select("extension_until")
      .eq("profile_id", session.user.profileId)
      .eq("local_date", localDate)
      .maybeSingle(),
  ]);

  // Default fallback: 18:00 ET (the standard end of a BBD shift).
  const endTime = (scheduleRes.data?.end_time ?? "18:00").slice(0, 5);
  const scheduledEnd = scheduledTimeInZone(now, endTime);

  const existingExtension = extensionRes.data?.extension_until
    ? new Date(extensionRes.data.extension_until)
    : null;

  const base =
    existingExtension && existingExtension > scheduledEnd
      ? existingExtension
      : scheduledEnd;
  const nextEnd = new Date(base.getTime() + parsed.data.minutes * 60_000);

  const { data, error } = await supabase
    .from("time_extensions")
    .upsert(
      {
        profile_id: session.user.profileId,
        local_date: localDate,
        extension_until: nextEnd.toISOString(),
        requested_minutes: parsed.data.minutes,
      },
      { onConflict: "profile_id,local_date" },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    extension: data,
    effective_end_iso: nextEnd.toISOString(),
  });
}
