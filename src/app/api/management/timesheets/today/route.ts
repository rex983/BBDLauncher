import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { isKnownDepartment, isKnownOffice } from "@/lib/org/lists";
import { loadTimesheetsToday } from "@/lib/timesheets/queries";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) return gate.response;
  const { supabase, scope } = gate;

  const url = new URL(req.url);
  const officeFilter = url.searchParams.get("office");
  const departmentFilter = url.searchParams.get("department");
  if (!(await isKnownOffice(officeFilter))) {
    return NextResponse.json({ error: "Invalid office" }, { status: 400 });
  }
  if (!(await isKnownDepartment(departmentFilter))) {
    return NextResponse.json({ error: "Invalid department" }, { status: 400 });
  }

  const rows = await loadTimesheetsToday({
    supabase,
    scope: { department: scope.department, office: scope.office },
    departmentOverride: departmentFilter,
    officeOverride: officeFilter,
  });

  // Short private cache so quick filter flips reuse the response
  // instead of hitting Supabase every time. The 30s tick in the client
  // re-derives durations locally, so 15s of freshness is fine.
  return NextResponse.json(rows, {
    headers: {
      "Cache-Control": "private, max-age=15, stale-while-revalidate=30",
    },
  });
}
