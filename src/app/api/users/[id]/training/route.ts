import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import { canManageContent, isAdmin } from "@/lib/auth/permissions";
import { managerTargetError } from "@/lib/auth/user-admin";
import { permRoleResolver } from "@/lib/auth/perm-role";
import { validationError } from "@/app/api/_lib/validation";
import { listTrainingPrograms, readTraining, setTraining } from "@/lib/handbook-training";

// In/out of training for the Employee Handbook, set from Admin → Users.
// Same rules as editing the user: admins anyone; managers people below them
// in their own office.

const UUID = /^[0-9a-f-]{36}$/i;

async function gate(req: NextRequest, id: string) {
  const session = await requireSession(canManageContent);
  if (session instanceof NextResponse) return session;
  if (!UUID.test(id)) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!isAdmin(session.user.permRole)) {
    const { data: target } = await createAdminClient().from("profiles").select("role, office").eq("id", id).maybeSingle();
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    // Reading is allowed for anyone the manager can see in their office; changing follows the edit rules.
    if (req.method !== "GET" || target.office !== session.user.office) {
      const permRoleOf = await permRoleResolver();
      const err = managerTargetError(
        { role: session.user.permRole, office: session.user.office },
        { ...target, role: permRoleOf(target.role) },
      );
      if (err) return NextResponse.json({ error: err }, { status: 403 });
    }
  }
  return session;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await gate(req, id);
  if (session instanceof NextResponse) return session;
  const [status, programs] = await Promise.all([readTraining(id), listTrainingPrograms()]);
  return NextResponse.json({ status, programs });
}

const putSchema = z.object({
  inTraining: z.boolean(),
  programId: z.string().regex(UUID).nullable().optional(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await gate(req, id);
  if (session instanceof NextResponse) return session;
  const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  const res = await setTraining(id, parsed.data.inTraining, parsed.data.programId ?? null, session.user.name || session.user.email || "Launcher");
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });
  return NextResponse.json({ status: await readTraining(id) });
}
