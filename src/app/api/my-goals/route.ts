import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { repInsights } from "@/lib/rep-insights";
import { canViewAs } from "@/lib/launcher/view-as";

// The signed-in rep's goals and numbers from Rep Insights (their profile and
// the clock-in screen), and submitting their goals for the month. Anyone who
// isn't a rep there gets { rep: false } and sees nothing. ?as=<profile id>:
// View as, that person's (when the viewer may View as them); never saves.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.profileId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const as = new URL(req.url).searchParams.get("as");
  if (as && as !== session.user.profileId && (await canViewAs(session.user.profileId, as)) !== true) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { status, body } = await repInsights(as || session.user.profileId);
  if (status === 404) return NextResponse.json({ rep: false });
  return NextResponse.json(status === 200 ? { rep: true, ...(body as object) } : body, { status });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.profileId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const json = (await req.json().catch(() => null)) as { goals?: unknown } | null;
  if (!json?.goals || typeof json.goals !== "object") return NextResponse.json({ error: "goals are required" }, { status: 400 });
  const { status, body } = await repInsights(session.user.profileId, { goals: json.goals as Record<string, unknown> });
  return NextResponse.json(status === 200 ? { rep: true, ...(body as object) } : body, { status });
}
