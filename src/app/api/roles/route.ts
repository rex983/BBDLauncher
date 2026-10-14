import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-session";
import { BUILTIN_ROLES, isActsAsTarget } from "@/lib/auth/permissions";
import { bustLauncherCache } from "@/lib/launcher/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Admin-only, every method (real role === "admin"). Pages that only need the
// role list (Admin -> Users, the app access grid) get it from their server
// render instead.

// Lowercase, snake_case identifier — used as FK in profiles.role and
// launcher_role_app_access.role_name. Immutable after creation.
const ROLE_NAME_RE = /^[a-z][a-z0-9_]{1,30}$/;

const createSchema = z.object({
  name: z.string().regex(ROLE_NAME_RE, "Use lowercase letters, digits, underscores (2–31 chars)"),
  display_name: z.string().trim().min(1).max(60),
  description: z.string().max(200).optional().nullable(),
  /** Built-in role whose launcher + in-app permissions this role gets; null = least privilege. */
  acts_as: z.string().nullable().optional(),
  /** Copy this role's app access grid rows onto the new role. */
  copy_access_from: z.string().nullable().optional(),
});

const ACTS_AS_ERROR = "\"Permissions like\" must be a built-in role other than admin.";

export async function GET() {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  const supabase = createAdminClient();
  const { data: roles } = await supabase
    .from("launcher_roles")
    .select("*")
    .order("name");

  return NextResponse.json(roles || []);
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const name = parsed.data.name.toLowerCase();
  const actsAs = parsed.data.acts_as || null;
  const copyFrom = parsed.data.copy_access_from || null;

  // 'admin' and the other built-in names are reserved (seeded by migration;
  // app code gives them their meaning). Custom roles can never be admin.
  if (BUILTIN_ROLES.has(name)) {
    return NextResponse.json({ error: `"${name}" is a reserved role name.` }, { status: 400 });
  }
  if (actsAs && !isActsAsTarget(actsAs)) {
    return NextResponse.json({ error: ACTS_AS_ERROR }, { status: 400 });
  }

  const supabase = createAdminClient();

  if (copyFrom) {
    const { data: source } = await supabase
      .from("launcher_roles")
      .select("name")
      .eq("name", copyFrom)
      .maybeSingle();
    if (!source) {
      return NextResponse.json({ error: "Unknown role to copy app access from" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("launcher_roles")
    .insert({
      name,
      display_name: parsed.data.display_name,
      description: parsed.data.description ?? null,
      is_admin: false,
      // Only sent when set, so creating a plain role still works before
      // migration 051 adds the column.
      ...(actsAs ? { acts_as: actsAs } : {}),
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A role with that name already exists." }, { status: 409 });
    }
    // The acts_as CHECK / trigger (migration 051).
    if (error.code === "23514" || error.code === "23503") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Copy the source role's app access, office by office (like migration 036).
  let copied = 0;
  let copyError: string | null = null;
  if (copyFrom) {
    const { data: rows, error: readError } = await supabase
      .from("launcher_role_app_access")
      .select("app_id, office")
      .eq("role_name", copyFrom);
    if (readError) {
      copyError = readError.message;
    } else if (rows?.length) {
      const { error: insError } = await supabase
        .from("launcher_role_app_access")
        .insert(rows.map((r) => ({ role_name: name, app_id: r.app_id, office: r.office ?? null })));
      if (insError) copyError = insError.message;
      else copied = rows.length;
    }
  }

  bustLauncherCache("roles");
  if (copied) bustLauncherCache("apps");
  return NextResponse.json(
    {
      ...data,
      copied_access_rows: copied,
      ...(copyError ? { warning: `Role created, but copying app access failed: ${copyError}` } : {}),
    },
    { status: 201 },
  );
}
