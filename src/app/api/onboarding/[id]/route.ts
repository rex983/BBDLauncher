import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { validationError } from "@/app/api/_lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptPassword } from "@/lib/onboarding/crypto";
import {
  closedError,
  getDetail,
  getRequest,
  notifyLoginReady,
  purgeRequest,
  requireOnboardingUser,
  requireOnboardingViewer,
} from "@/lib/onboarding/service";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await requireOnboardingViewer();
  if (session instanceof NextResponse) return session;
  const detail = await getDetail(session, (await params).id);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(detail);
}

// Tick a checklist item: admins any; the manager who opened it, items with
// people on them; people on an item, their own (who's on an item is set on
// the default checklist). Hand back the login: admins, while
// the request is open (a new password replaces any earlier one and re-arms
// the one-time view). The checklist stays open after the 30 days; training
// steps come later.
const uuid = z.string().uuid();
const patchSchema = z.union([
  z.object({ task_id: uuid, done: z.boolean() }),
  z.object({
    account_email: z.string().trim().email().max(200),
    password: z.string().min(1, "required").max(200),
  }),
]);

const forbidden = (error: string) => NextResponse.json({ error }, { status: 403 });

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await requireOnboardingViewer();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const current = await getRequest(session, id);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return validationError(parsed.error);
  const body = parsed.data;

  if ("task_id" in body) {
    const task = current.tasks.find((t) => t.id === body.task_id);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const me = session.user.profileId;
    const mine = task.assignees.some((a) => a.id === me);
    const ok = current.role === "admin" || mine || (current.role === "requester" && task.assignees.length > 0);
    if (!ok) return forbidden("Only the people on this item (or an admin) can tick it");
  } else {
    if (current.role !== "admin") return forbidden("Only admins enter the login");
    const closed = closedError(current);
    if (closed) return closed;
  }

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
  const current = await getRequest(session, id);
  if (!current || current.role === "assignee") return NextResponse.json({ error: "Not found" }, { status: 404 });
  await purgeRequest(id);
  return NextResponse.json({ ok: true });
}
