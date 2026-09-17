import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { TIME_OFF_SUBCATEGORIES } from "@/lib/timeoff/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const VALID_STATUSES = new Set(["pending", "approved", "denied", "cancelled"]);
const VALID_OFFICES = new Set(["Harbor", "Marion", "BST", "RnD"]);
const VALID_DEPARTMENTS = new Set(["SALES TEAM", "BST", "RnD"]);

// Manager creates a time-off row on behalf of an employee (sick day,
// personal absence, whatever). Auto-approved with decided_by=manager so
// the employee doesn't have to touch anything.
const createSchema = z.object({
  profile_id: z.string().uuid(),
  type: z.enum(["vacation", "sick", "personal", "parental", "other"]),
  subcategory: z.string().max(64).nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  full_day: z.boolean().default(true),
  hours: z.number().positive().max(24).nullable().optional(),
  reason: z.string().max(2000).optional(),
});

// List time-off requests for everyone in the viewer's department scope.
// Filter by status via ?status=pending|approved|denied|cancelled (default: pending).
export async function GET(req: NextRequest) {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) return gate.response;
  const { supabase, scope } = gate;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "pending";
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  // Admin-only overlay filters (scope.office/department already dominate
  // for manager-tier viewers, so these only apply when scope is unbounded).
  const officeFilter = url.searchParams.get("office");
  const departmentFilter = url.searchParams.get("department");
  if (officeFilter && !VALID_OFFICES.has(officeFilter)) {
    return NextResponse.json({ error: "Invalid office" }, { status: 400 });
  }
  if (departmentFilter && !VALID_DEPARTMENTS.has(departmentFilter)) {
    return NextResponse.json({ error: "Invalid department" }, { status: 400 });
  }

  let profileQuery = supabase
    .from("profiles")
    .select("id, email, name:full_name, office, department")
    .eq("is_active", true);
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
  const { data: profiles } = await profileQuery;
  const profileIds = (profiles || []).map((p) => p.id);
  if (profileIds.length === 0) return NextResponse.json([]);

  const { data: requests, error } = await supabase
    .from("time_off_requests")
    .select(
      "id, profile_id, type, subcategory, start_date, end_date, full_day, hours, status, reason, decided_note, decided_by, decided_at, created_at, attachments",
    )
    .in("profile_id", profileIds)
    .eq("status", status)
    .order("start_date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  return NextResponse.json(
    (requests || []).map((r) => ({ ...r, profile: profileMap.get(r.profile_id) })),
  );
}

export async function POST(req: NextRequest) {
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

  // Scope check binds to the target profile — manager can only mark
  // people inside their department/office, admins can mark anyone.
  const gate = await requireTimeDataAccess(parsed.data.profile_id, "edit");
  if (!gate.ok) return gate.response;
  const { session, supabase } = gate;

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

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("time_off_requests")
    .insert({
      profile_id: parsed.data.profile_id,
      type: parsed.data.type,
      subcategory: sub,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      full_day: parsed.data.full_day,
      hours: parsed.data.hours ?? null,
      reason: parsed.data.reason ?? null,
      attachments: [],
      status: "approved",
      decided_by: session.user.profileId,
      decided_at: nowIso,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
