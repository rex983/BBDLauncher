import { auth } from "@/auth";
import { getMyStateToday } from "@/lib/timesheets/server";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { state, punches } = await getMyStateToday(session.user.profileId);
  return NextResponse.json({ state, punches });
}
