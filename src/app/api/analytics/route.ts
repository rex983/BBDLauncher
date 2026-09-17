import { auth } from "@/auth";
import { analyticsScope } from "@/lib/auth/permissions";
import {
  ANALYTICS_RANGES,
  getLauncherAnalytics,
  isAnalyticsRange,
} from "@/lib/analytics/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const scope = analyticsScope(session?.user?.role, session?.user?.office ?? null);
    if (!session?.user || !scope.allowed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const rangeParam = req.nextUrl.searchParams.get("range") ?? "30d";
    if (!isAnalyticsRange(rangeParam)) {
      return NextResponse.json(
        { error: `Invalid range. Must be one of: ${ANALYTICS_RANGES.join(", ")}` },
        { status: 400 }
      );
    }

    const data = await getLauncherAnalytics(rangeParam, { office: scope.office });
    return NextResponse.json(data);
  } catch (err) {
    console.error("Analytics error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analytics failed" },
      { status: 500 }
    );
  }
}
