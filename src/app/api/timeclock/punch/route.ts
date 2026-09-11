import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyStateToday } from "@/lib/timesheets/server";
import type { LiveStatus, PunchEventType } from "@/lib/timesheets/state";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const schema = z.object({
  event_type: z.enum([
    "clock_in", "clock_out",
    "lunch_start", "lunch_end",
    "break_start", "break_end",
  ]),
  note: z.string().max(500).optional(),
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
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { state } = await getMyStateToday(session.user.profileId);
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

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("time_punches")
    .insert({
      profile_id: session.user.profileId,
      event_type: parsed.data.event_type,
      occurred_at: new Date().toISOString(),
      source: "web",
      note: parsed.data.note ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Return the freshly-computed state so the client updates without a refetch.
  const { state: newState, punches } = await getMyStateToday(session.user.profileId);
  return NextResponse.json({ punch: data, state: newState, punches }, { status: 201 });
}
