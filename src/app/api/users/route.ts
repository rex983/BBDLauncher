import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageContent, isAdmin } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const createSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  name: z.string().optional(),
  role: z.string().min(1).default("sales_rep"),
  office: z.enum(["Harbor", "Marion", "BST", "RnD"]).nullable().optional(),
  department: z.enum(["SALES TEAM", "BST", "RnD"]).nullable().optional(),
  is_it: z.boolean().optional(),
});

const USER_COLUMNS =
  "id, email, name:full_name, role, office, department, is_it, is_active, created_at, updated_at";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !canManageContent(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

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
  const session = await auth();
  if (!session?.user || !canManageContent(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { email, name, role, office, department, is_it } = parsed.data;

  // Only admins can grant admin role.
  if (role === "admin" && !isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Only admins can assign the admin role." },
      { status: 403 }
    );
  }

  // IT capability gates the Help Desk queue — admin-only to grant.
  if (is_it && !isAdmin(session.user.role)) {
    return NextResponse.json(
      { error: "Only admins can grant the IT capability." },
      { status: 403 }
    );
  }

  const supabase = createAdminClient();

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
