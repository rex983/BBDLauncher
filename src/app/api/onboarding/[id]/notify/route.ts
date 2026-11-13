import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validationError } from "@/app/api/_lib/validation";
import { getDetail, getRequest, notifyTask, requireOnboardingUser } from "@/lib/onboarding/service";

// "Notify on Slack" for one checklist item: admins and the manager who opened
// the request. Tags the item's people in Slack and rings their bell. Works
// after the 30 days too (training steps come later).
const bodySchema = z.object({ task_id: z.string().uuid() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOnboardingUser();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const current = await getRequest(session, id);
  if (!current || current.role === "assignee") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return validationError(parsed.error);

  const res = await notifyTask(current, parsed.data.task_id, {
    profileId: session.user.profileId,
    name: session.user.name || session.user.email || "A manager",
  });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: 400 });
  // The bell went out either way; say when Slack didn't.
  return NextResponse.json({
    detail: await getDetail(session, id),
    slack_error: res.slack === "skipped" ? "Slack isn't set up, so only the bell went out." : res.slack,
  });
}
