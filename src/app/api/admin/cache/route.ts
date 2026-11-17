import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-session";
import { clearCaches } from "@/lib/cache-clear";

export const dynamic = "force-dynamic";

// POST { target }: "all", "launcher" or an app id. Admins only. Returns one
// result per thing cleared; a failed app doesn't fail the others.
export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  const body = (await req.json().catch(() => null)) as { target?: unknown } | null;
  const target = typeof body?.target === "string" ? body.target : "";
  if (!target || target.length > 64) {
    return NextResponse.json({ error: "target is required" }, { status: 400 });
  }

  try {
    const results = await clearCaches(target);
    if (!results) return NextResponse.json({ error: "Unknown app" }, { status: 404 });
    const failed = results.filter((r) => !r.ok).map((r) => r.name);
    console.log(
      `[cache-clear] ${session.user.email} cleared ${target}: ${results.length - failed.length} ok` +
        (failed.length ? `, failed: ${failed.join(", ")}` : ""),
    );
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
