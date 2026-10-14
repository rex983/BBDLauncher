import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/require-session";
import { BUILTIN_ROLES, isActsAsTarget } from "@/lib/auth/permissions";
import { bustLauncherCache } from "@/lib/launcher/cache";
import { NextRequest, NextResponse } from "next/server";
import { validationError } from "@/app/api/_lib/validation";
import { z } from "zod";

// Admin-only (real role === "admin"). The name is immutable.

const updateSchema = z.object({
  display_name: z.string().trim().min(1).max(60).optional(),
  description: z.string().max(200).nullable().optional(),
  /** Built-in role whose permissions this role gets; null = least privilege. */
  acts_as: z.string().nullable().optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  const { name } = await params;
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.display_name !== undefined) updates.display_name = parsed.data.display_name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.acts_as !== undefined) {
    const actsAs = parsed.data.acts_as || null;
    // Built-ins have fixed meanings in every app; giving one acts_as would
    // silently change everyone already on it (the database refuses it too).
    if (BUILTIN_ROLES.has(name)) {
      if (actsAs) {
        return NextResponse.json({ error: "Built-in roles keep their own permissions." }, { status: 400 });
      }
    } else {
      if (actsAs && !isActsAsTarget(actsAs)) {
        return NextResponse.json(
          { error: "\"Permissions like\" must be a built-in role other than admin." },
          { status: 400 },
        );
      }
      updates.acts_as = actsAs;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("launcher_roles")
    .update(updates)
    .eq("name", name)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === "23514" || error.code === "23503") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Launcher sessions re-resolve permRole from this cache on their next
  // request; other apps pick it up on their 60s recheck.
  bustLauncherCache("roles");
  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  const { name } = await params;

  if (name === "admin") {
    return NextResponse.json(
      { error: "The 'admin' role cannot be deleted." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Block delete if any users still hold this role — safer than orphaning.
  const { count: userCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", name);

  if ((userCount ?? 0) > 0) {
    return NextResponse.json(
      { error: `${userCount} user(s) still have this role. Reassign them first.` },
      { status: 409 }
    );
  }

  // launcher_role_app_access.role_name has ON DELETE CASCADE, so removing the
  // role drops its access rows too. Roles acting as this one fall back to
  // least privilege (acts_as ON DELETE SET NULL, migration 051).
  const { error } = await supabase
    .from("launcher_roles")
    .delete()
    .eq("name", name);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  bustLauncherCache("roles");
  bustLauncherCache("apps");
  return NextResponse.json({ success: true });
}
