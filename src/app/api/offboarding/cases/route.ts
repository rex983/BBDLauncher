import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logOffboardingEvent } from "@/lib/offboarding/audit";
import { listCases, notifyAssignee, openCase, requireOffboarder } from "@/lib/offboarding/service";
import { OFFBOARDING_REASON_VALUES } from "@/lib/offboarding/types";

const createSchema = z.object({
  profile_id: z.string().uuid(),
  last_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.enum(OFFBOARDING_REASON_VALUES),
  notes: z.string().max(4000).nullable().optional(),
});

export async function GET() {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  return NextResponse.json(await listCases());
}

export async function POST(req: NextRequest) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await openCase({
    session,
    profileId: parsed.data.profile_id,
    lastDay: parsed.data.last_day,
    reason: parsed.data.reason,
    notes: parsed.data.notes?.trim() || null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await logOffboardingEvent({
    caseId: result.caseId,
    eventType: "case_opened",
    session,
    req,
    details: { last_day: parsed.data.last_day, reason: parsed.data.reason },
  });
  for (const assigneeId of result.assignees) {
    if (assigneeId === session.user.profileId) continue;
    notifyAssignee({ assigneeId, caseId: result.caseId, employeeLabel: result.employeeLabel }).catch(
      () => undefined,
    );
  }

  return NextResponse.json({ id: result.caseId }, { status: 201 });
}
