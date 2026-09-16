import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { TIME_OFF_SUBCATEGORIES } from "@/lib/timeoff/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const attachmentSchema = z.object({
  path: z.string().min(1).max(256),
  filename: z.string().min(1).max(256),
  size: z.number().int().nonnegative().max(10 * 1024 * 1024),
  mime: z.string().min(1).max(128),
});

const createSchema = z.object({
  type: z.enum(["vacation", "sick", "personal", "parental", "other"]),
  subcategory: z.string().max(64).nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  full_day: z.boolean().default(true),
  hours: z.number().positive().max(24).nullable().optional(),
  reason: z.string().max(2000).optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("time_off_requests")
    .select(
      "id, type, subcategory, start_date, end_date, full_day, hours, status, reason, decided_note, decided_at, created_at, attachments",
    )
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
  // Reject unknown subcategories so a stale client can't drift the taxonomy.
  // Empty subcategory is fine — 'other' has none, and users can skip it.
  const sub = parsed.data.subcategory?.trim() || null;
  if (sub) {
    const allowed = TIME_OFF_SUBCATEGORIES[parsed.data.type];
    if (!allowed.includes(sub)) {
      return NextResponse.json(
        { error: `Invalid subcategory for ${parsed.data.type}` },
        { status: 400 },
      );
    }
  }

  // Attachment paths MUST live under the submitter's own folder — otherwise
  // a client could claim a file uploaded by someone else. The upload
  // endpoint always writes to `{profileId}/...`, so we just verify the
  // prefix here.
  const attachments = parsed.data.attachments ?? [];
  const prefix = `${session.user.profileId}/`;
  for (const a of attachments) {
    if (!a.path.startsWith(prefix)) {
      return NextResponse.json({ error: "Invalid attachment path" }, { status: 400 });
    }
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("time_off_requests")
    .insert({
      profile_id: session.user.profileId,
      type: parsed.data.type,
      subcategory: sub,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      full_day: parsed.data.full_day,
      hours: parsed.data.hours ?? null,
      reason: parsed.data.reason ?? null,
      attachments,
      status: "pending",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
