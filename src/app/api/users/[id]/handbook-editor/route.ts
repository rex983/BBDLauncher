import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, requireAdmin } from "@/lib/auth/require-session";
import { canManageContent } from "@/lib/auth/permissions";
import { validationError } from "@/app/api/_lib/validation";
import { bustLauncherCache } from "@/lib/launcher/cache";
import { readHandbookEditor, setHandbookEditor } from "@/lib/handbook-training";

// "Can edit the Employee Handbook", beyond admins and senior/junior managers
// (who always can). Anyone on the users page can see it; only admins change
// it, like IT and offboarding.

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(canManageContent);
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ allowed: await readHandbookEditor(id) });
}

const putSchema = z.object({ allowed: z.boolean() });

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationError(parsed.error);

  const res = await setHandbookEditor(id, parsed.data.allowed, session.user.name || session.user.email || "Launcher");
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });
  // A new personal grant on the tile shows on their dashboard right away.
  if (res.accessAdded) bustLauncherCache("apps");
  return NextResponse.json({ allowed: parsed.data.allowed, accessAdded: res.accessAdded });
}
