import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { canManageContent } from "@/lib/auth/permissions";
import { loadPersonSummary } from "@/lib/people/summary";

// GET /api/people/<profile_id> — the card behind a clickable name
// (PersonLink). Admins and managers only; what it holds follows the viewer's
// own scopes (src/lib/people/summary.ts).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(canManageContent);
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const person = await loadPersonSummary(session.user, id);
  if (!person) return NextResponse.json({ error: "Person not found" }, { status: 404 });
  return NextResponse.json(person, { headers: { "Cache-Control": "private, no-store" } });
}
