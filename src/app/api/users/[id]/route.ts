import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import { canManageContent, isAdmin } from "@/lib/auth/permissions";
import { managerAssignError, managerTargetError } from "@/lib/auth/user-admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DEPARTMENTS, OFFICES } from "@/lib/org/constants";

const updateSchema = z.object({
  name: z.string().nullable().optional(),
  role: z.string().min(1).optional(),
  office: z.enum(OFFICES).nullable().optional(),
  department: z.enum(DEPARTMENTS).nullable().optional(),
  is_it: z.boolean().optional(),
  can_offboard: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

const USER_COLUMNS =
  "id, email, name:full_name, role, office, department, is_it, can_offboard, is_active, created_at, updated_at";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(canManageContent);
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.full_name = parsed.data.name;
  if (parsed.data.role !== undefined) updates.role = parsed.data.role;
  if (parsed.data.office !== undefined) updates.office = parsed.data.office;
  if (parsed.data.department !== undefined) updates.department = parsed.data.department;
  if (parsed.data.is_it !== undefined) updates.is_it = parsed.data.is_it;
  if (parsed.data.can_offboard !== undefined) updates.can_offboard = parsed.data.can_offboard;
  if (parsed.data.is_active !== undefined) updates.is_active = parsed.data.is_active;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const securityChange =
    parsed.data.role !== undefined ||
    parsed.data.office !== undefined ||
    parsed.data.department !== undefined ||
    parsed.data.is_it !== undefined ||
    parsed.data.can_offboard !== undefined ||
    parsed.data.is_active !== undefined;
  const viewerIsAdmin = isAdmin(session.user.role);
  const needsPrefetch = !viewerIsAdmin || securityChange;
  const deactivating = parsed.data.is_active === false;

  // Any assigned role must be an existing entry in launcher_roles. Without
  // this check a manager could stamp a user with an arbitrary string that
  // downstream permission helpers wouldn't recognize.
  if (parsed.data.role !== undefined) {
    const { data: roleRow } = await supabase
      .from("launcher_roles")
      .select("name")
      .eq("name", parsed.data.role)
      .maybeSingle();
    if (!roleRow) {
      return NextResponse.json(
        { error: "Unknown role" },
        { status: 400 }
      );
    }
  }

  if (needsPrefetch) {
    const { data: before } = await supabase
      .from("profiles")
      .select("role, office, department, is_active, session_version")
      .eq("id", id)
      .single();
    if (!before) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (!viewerIsAdmin) {
      const deny = (error: string) => NextResponse.json({ error }, { status: 403 });
      if (id === session.user.profileId) {
        // The form sends every field, so only refuse actual changes.
        const changed =
          (parsed.data.role !== undefined && parsed.data.role !== before.role) ||
          (parsed.data.office !== undefined && parsed.data.office !== before.office) ||
          (parsed.data.department !== undefined && parsed.data.department !== before.department) ||
          (parsed.data.is_active !== undefined && parsed.data.is_active !== before.is_active);
        if (changed) return deny("You can't change your own role, office, department or status.");
      } else {
        const targetError = managerTargetError(session.user, before);
        if (targetError) return deny(targetError);
        const assignError = managerAssignError(session.user, {
          role: parsed.data.role,
          office: parsed.data.office,
        });
        if (assignError) return deny(assignError);
      }
      if (parsed.data.is_it !== undefined) {
        return NextResponse.json(
          { error: "Only admins can change the IT capability." },
          { status: 403 }
        );
      }
      if (parsed.data.can_offboard !== undefined) {
        return NextResponse.json(
          { error: "Only admins can change who runs offboarding." },
          { status: 403 }
        );
      }
    }

    // Bump session_version when role/office changes so live JWTs in sibling
    // apps (QSB, ASC) refresh on next request instead of carrying stale claims.
    if (securityChange) {
      updates.session_version = ((before?.session_version as number | null) ?? 1) + 1;
    }
  }

  // Deactivation also bumps signed_out_at so the launcher jwt callback
  // ejects the user on their very next request rather than waiting for a
  // natural token refresh.
  if (deactivating) {
    updates.signed_out_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", id)
    .select(USER_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(canManageContent);
  if (session instanceof NextResponse) return session;

  const { id } = await params;

  if (session.user.profileId === id) {
    return NextResponse.json(
      { error: "You cannot delete your own account." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Managers can only delete people below them in their own office.
  if (!isAdmin(session.user.role)) {
    const { data: target } = await supabase
      .from("profiles")
      .select("role, office")
      .eq("id", id)
      .single();
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const targetError = managerTargetError(session.user, target);
    if (targetError) return NextResponse.json({ error: targetError }, { status: 403 });
  }

  // Delete the profile directly. ASC manages its own auth.users lifecycle —
  // launcher does not touch Supabase Auth users on the shared DB.
  const { error } = await supabase.from("profiles").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
