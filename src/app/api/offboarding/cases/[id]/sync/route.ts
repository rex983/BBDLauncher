import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/permissions";
import { logOffboardingEvent } from "@/lib/offboarding/audit";
import { requireOffboarder, syncCaseToChecklist } from "@/lib/offboarding/service";

// Admin: make this open case match the checklist (sections, order, wording,
// tasks). Finished work is kept.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireOffboarder();
  if (session instanceof NextResponse) return session;
  if (!isAdmin(session.user.role)) {
    return NextResponse.json({ error: "Only admins can re-sync a case." }, { status: 403 });
  }
  const { id } = await params;

  const result = await syncCaseToChecklist(id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await logOffboardingEvent({
    caseId: id,
    eventType: "case_synced",
    session,
    req,
    details: { added: result.added, removed: result.removed, kept: result.kept },
  });
  return NextResponse.json(result);
}
