import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { loadTimesheetsToday } from "@/lib/timesheets/queries";
import { NextRequest, NextResponse } from "next/server";

const VALID_OFFICES = new Set(["Harbor", "Marion", "BST", "RnD"]);
const VALID_DEPARTMENTS = new Set(["SALES TEAM", "BST", "RnD"]);

export async function GET(req: NextRequest) {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) return gate.response;
  const { supabase, scope } = gate;

  const url = new URL(req.url);
  const officeFilter = url.searchParams.get("office");
  const departmentFilter = url.searchParams.get("department");
  if (officeFilter && !VALID_OFFICES.has(officeFilter)) {
    return NextResponse.json({ error: "Invalid office" }, { status: 400 });
  }
  if (departmentFilter && !VALID_DEPARTMENTS.has(departmentFilter)) {
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
