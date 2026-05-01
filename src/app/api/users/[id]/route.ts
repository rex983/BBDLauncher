import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageContent, isAdmin } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().nullable().optional(),
  role: z.string().min(1).optional(),
  office: z.enum(["Harbor", "Marion"]).nullable().optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !canManageContent(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

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

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const securityChange =
    parsed.data.role !== undefined || parsed.data.office !== undefined;
  const viewerIsAdmin = isAdmin(session.user.role);
  const needsPrefetch = !viewerIsAdmin || securityChange;

  if (needsPrefetch) {
    const { data: before } = await supabase
      .from("profiles")
      .select("role, session_version")
      .eq("id", id)
      .single();

    if (!viewerIsAdmin) {
      if (before?.role === "admin") {
        return NextResponse.json(
          { error: "Only admins can modify an admin account." },
          { status: 403 }
        );
      }
      if (parsed.data.role === "admin") {
        return NextResponse.json(
          { error: "Only admins can assign the admin role." },
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

  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", id)
    .select("id, email, name:full_name, role, office, created_at, updated_at")
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
  const session = await auth();
  if (!session?.user || !canManageContent(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;

  if (session.user.profileId === id) {
    return NextResponse.json(
      { error: "You cannot delete your own account." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Non-admins can't delete admin accounts.
  if (!isAdmin(session.user.role)) {
    const { data: target } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", id)
      .single();
    if (target?.role === "admin") {
      return NextResponse.json(
        { error: "Only admins can delete an admin account." },
        { status: 403 }
      );
    }
  }

  // Delete the profile directly. ASC manages its own auth.users lifecycle —
  // launcher does not touch Supabase Auth users on the shared DB.
  const { error } = await supabase.from("profiles").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
