import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyStateToday, lateClockIn } from "@/lib/timesheets/server";
import type { LiveStatus, PunchEventType, TimePunch } from "@/lib/timesheets/state";
import { NextRequest, NextResponse } from "next/server";
import { validationError } from "@/app/api/_lib/validation";
import { z } from "zod";
import { PUNCH_EVENT_TYPES, computeState } from "@/lib/timesheets/state";

const schema = z.object({
  event_type: z.enum(PUNCH_EVENT_TYPES),
  note: z.string().max(500).optional(),
  // Required when the day's first clock-in is past the grace period.
  late_reason: z.string().trim().max(500).optional(),
});

// Legal state transitions. Anything else is rejected as a client error to
// keep the event log sane (no lunch_start while already on lunch, etc.).
const LEGAL_TRANSITIONS: Record<LiveStatus, PunchEventType[]> = {
  clocked_out: ["clock_in"],
  working:     ["clock_out", "lunch_start", "break_start"],
  on_lunch:    ["lunch_end", "clock_out"],
  on_break:    ["break_end", "clock_out"],
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  // The lateness check only matters for a clock-in, but it doesn't depend on
  // today's punches, so it runs alongside them instead of after.
  const [{ state, punches: todays }, late] = await Promise.all([
    getMyStateToday(session.user.profileId),
    parsed.data.event_type === "clock_in"
      ? lateClockIn(session.user.profileId)
      : Promise.resolve(null),
  ]);
  const allowed = LEGAL_TRANSITIONS[state.status];
  if (!allowed.includes(parsed.data.event_type)) {
    return NextResponse.json(
      {
        error: `Can't ${parsed.data.event_type.replace("_", " ")} while ${state.status.replace("_", " ")}`,
        current_status: state.status,
      },
      { status: 409 },
    );
  }

  // Late first clock-in: the employee has to say why. The reason is stored
  // as the punch note, where managers see it on the timesheet and the
  // attendance log.
  let note = parsed.data.note ?? null;
  if (
    parsed.data.event_type === "clock_in" &&
    !todays.some((p) => p.event_type === "clock_in")
  ) {
    if (late) {
      const reason = parsed.data.late_reason ?? "";
      if (reason.length < 3) {
        return NextResponse.json(
          {
            error: "Tell your manager why you're late before clocking in.",
            late_reason_required: true,
            minutes_late: late.minutes,
            scheduled_start: late.scheduled_start,
          },
          { status: 422 },
        );
      }
      note = reason;
    }
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("time_punches")
    .insert({
      profile_id: session.user.profileId,
      event_type: parsed.data.event_type,
      occurred_at: new Date().toISOString(),
      source: "web",
      note,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Return the new state so the client updates without a refetch. It's folded
  // from the punches read above plus the row just inserted (always the
  // latest), which saves re-reading the day.
  const punches = [...todays, data as TimePunch];
  return NextResponse.json({ punch: data, state: computeState(punches), punches }, { status: 201 });
}
