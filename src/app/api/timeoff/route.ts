import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const createSchema = z.object({
  type: z.enum(["vacation", "sick", "personal", "other"]),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  full_day: z.boolean().default(true),
  hours: z.number().positive().max(24).nullable().optional(),
  reason: z.string().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("time_off_requests")
    .select("*")
    .eq("profile_id", session.user.profileId)
    .order("start_date", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.end_date < parsed.data.start_date) {
    return NextResponse.json({ error: "End date must be on or after start date" }, { status: 400 });
  }
  if (!parsed.data.full_day && !parsed.data.hours) {
    return NextResponse.json({ error: "Hours required for partial-day requests" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("time_off_requests")
    .insert({
      profile_id: session.user.profileId,
      type: parsed.data.type,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      full_day: parsed.data.full_day,
      hours: parsed.data.hours ?? null,
      reason: parsed.data.reason ?? null,
      status: "pending",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
