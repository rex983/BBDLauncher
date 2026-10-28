import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { canManageContent } from "@/lib/auth/permissions";
import { listTrainingPrograms } from "@/lib/handbook-training";

/** Employee Handbook training programs, for the user form's program picker. */
export async function GET() {
  const session = await requireSession(canManageContent);
  if (session instanceof NextResponse) return session;
  return NextResponse.json({ programs: await listTrainingPrograms() });
}
