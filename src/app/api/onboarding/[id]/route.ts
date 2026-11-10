import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { validationError } from "@/app/api/_lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth/permissions";
import { encryptPassword } from "@/lib/onboarding/crypto";
import {
  closedError,
  getDetail,
  getRequest,
  notifyLoginReady,
  purgeRequest,
  requireOnboardingUser,
} from "@/lib/onboarding/service";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await requireOnboardingUser();
  if (session instanceof NextResponse) return session;
  const detail = await getDetail(session, (await params).id);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(detail);
}

// Admin only: tick a checklist task, or hand back the login. A new password
// replaces any earlier one (and re-arms the one-time view).
const patchSchema = z.union([
  z.object({ task_id: z.string().uuid(), done: z.boolean() }),
  z.object({
    account_email: z.string().trim().email().max(200),
    password: z.string().min(1, "required").max(200),
  }),
]);

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await requireOnboardingUser();
  if (session instanceof NextResponse) return session;
  if (!isAdmin(session.user.permRole)) {
    return NextResponse.json({ error: "Only admins work the checklist" }, { status: 403 });
  }
  const { id } = await params;
  const current = await getRequest(session, id);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const closed = closedError(current);
  if (closed) return closed;

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return validationError(parsed.error);
  const body = parsed.data;

  const now = new Date().toISOString();
  const supabase = createAdminClient();
  const { error } =
    "task_id" in body
      ? await supabase
          .from("onboarding_tasks")
          .update({ done_at: body.done ? now : null })
          .eq("id", body.task_id)
          .eq("request_id", id)
      : await supabase
          .from("onboarding_requests")
          .update({
            account_email: body.account_email,
            password_cipher: encryptPassword(body.password),
            password_set_at: now,
            password_viewed_at: null,
          })
          .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if ("password" in body) {
    after(() =>
      notifyLoginReady(current, session.user.profileId).catch((e) => console.error("[onboarding] notify failed:", e)),
    );
  }
  return NextResponse.json(await getDetail(session, id));
}

// Delete now, open or closed (closed ones are otherwise kept): an admin, or
// the manager who opened it.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await requireOnboardingUser();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  if (!(await getRequest(session, id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await purgeRequest(id);
  return NextResponse.json({ ok: true });
}
