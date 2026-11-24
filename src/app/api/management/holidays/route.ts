import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validationError } from "@/app/api/_lib/validation";
import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { HOLIDAY_COLUMNS } from "@/lib/timeoff/holidays";

// Company holidays (migration 070). Company-wide, so there is no office or
// department scope: anyone who can see time data sees them all, and anyone
// who can edit time data (admins + managers) can add or remove one.

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
});

function missingTable(code?: string) {
  return code === "42P01" || code === "PGRST205";
}

const NOT_SET_UP = "Holidays aren't set up yet — apply migration 070 (company_holidays).";

export async function GET() {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) return gate.response;
  const { data, error } = await gate.supabase
    .from("company_holidays")
    .select(HOLIDAY_COLUMNS)
    .order("holiday_date", { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: missingTable(error.code) ? NOT_SET_UP : error.message },
      { status: missingTable(error.code) ? 503 : 500 },
    );
  }
  return NextResponse.json(data || []);
}

export async function POST(req: NextRequest) {
  const gate = await requireTimeDataAccess(null, "edit");
  if (!gate.ok) return gate.response;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);
  const { name, date } = parsed.data;
  // The regex lets "2026-02-31" through, and JS rolls it into March; only a
  // date that survives the round trip is real.
  const real = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== date) {
    return NextResponse.json({ error: "That isn't a real date." }, { status: 400 });
  }

  const { data, error } = await gate.supabase
    .from("company_holidays")
    .insert({ name, holiday_date: date, created_by: gate.session.user.profileId || null })
    .select(HOLIDAY_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "There is already a holiday on that date." }, { status: 409 });
    }
    return NextResponse.json(
      { error: missingTable(error.code) ? NOT_SET_UP : error.message },
      { status: missingTable(error.code) ? 503 : 500 },
    );
  }
  return NextResponse.json(data, { status: 201 });
}
