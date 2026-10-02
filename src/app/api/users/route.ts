import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import { canManageContent, isAdmin } from "@/lib/auth/permissions";
import { managerAssignError } from "@/lib/auth/user-admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DEPARTMENTS, OFFICES } from "@/lib/org/constants";

const createSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  name: z.string().optional(),
  role: z.string().min(1).default("sales_rep"),
  office: z.enum(OFFICES).nullable().optional(),
  department: z.enum(DEPARTMENTS).nullable().optional(),
  is_it: z.boolean().optional(),
  can_offboard: z.boolean().optional(),
});

const USER_COLUMNS =
  "id, email, name:full_name, role, office, department, is_it, can_offboard, is_active, created_at, updated_at";

export async function GET(req: NextRequest) {
  const session = await requireSession(canManageContent);
  if (session instanceof NextResponse) return session;

  const viewerIsAdmin = isAdmin(session.user.role);
  // Managers only ever see active users. Admins default to active but can
  // opt into the full list with ?includeInactive=1 (used by the admin UI's
  // "Show inactive" toggle).
  const includeInactive =
    viewerIsAdmin && req.nextUrl.searchParams.get("includeInactive") === "1";

  const supabase = createAdminClient();
  let query = supabase
    .from("profiles")
    .select(USER_COLUMNS)
    .order("email");
  if (!includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data: users } = await query;
  return NextResponse.json(users || []);
}

export async function POST(req: NextRequest) {
  const session = await requireSession(canManageContent);
  if (session instanceof NextResponse) return session;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { email, name, role, office, department, is_it, can_offboard } = parsed.data;

  // Managers can only add people below their own role, in their own office.
  if (!isAdmin(session.user.role)) {
    const assignError = managerAssignError(session.user, { role, office });
    if (assignError) return NextResponse.json({ error: assignError }, { status: 403 });
  }

  // IT capability gates the Help Desk queue — admin-only to grant.
  if (is_it && !isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Only admins can grant the IT capability." },
      { status: 403 }
    );
  }
  if (can_offboard && !isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Only admins can grant offboarding." },
      { status: 403 }
    );
  }

  const supabase = createAdminClient();

  const { data: roleRow } = await supabase
    .from("launcher_roles")
    .select("name")
    .eq("name", role)
    .maybeSingle();
  if (!roleRow) return NextResponse.json({ error: "Unknown role" }, { status: 400 });

  // Insert the profile directly. The shared DB has no auth.users FK on
  // profiles.id, and we don't manage Supabase Auth from the launcher —
  // users sign in via NextAuth (Google), which matches by email.
  // `approved: true` is required because ASC Engineering's signIn gate
  // blocks `approved === false`, and the column default is false.
  const { data: profile, error } = await supabase
    .from("profiles")
    .insert({
      email,
      full_name: name ?? null,
      role,
      office: office ?? null,
      department: department ?? null,
      is_it: is_it ?? false,
      can_offboard: can_offboard ?? false,
      approved: true,
    })
    .select(USER_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A user with that email already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(profile, { status: 201 });
}
