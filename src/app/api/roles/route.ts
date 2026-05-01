import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// Lowercase, snake_case identifier — used as FK in profiles.role and
// launcher_role_app_access.role_name. Immutable after creation.
const ROLE_NAME_RE = /^[a-z][a-z0-9_]{1,30}$/;

const createSchema = z.object({
  name: z.string().regex(ROLE_NAME_RE, "Use lowercase letters, digits, underscores (2–31 chars)"),
  display_name: z.string().min(1).max(60),
  description: z.string().max(200).optional().nullable(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: roles } = await supabase
    .from("launcher_roles")
    .select("*")
    .order("name");

  return NextResponse.json(roles || []);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const name = parsed.data.name.toLowerCase();

  // The 'admin' role is reserved — it's the only role that grants is_admin,
  // and it's seeded by migration. Custom roles can never be admin.
  if (name === "admin") {
    return NextResponse.json(
      { error: "The 'admin' role is reserved." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("launcher_roles")
    .insert({
      name,
      display_name: parsed.data.display_name,
      description: parsed.data.description ?? null,
      is_admin: false,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A role with that name already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
