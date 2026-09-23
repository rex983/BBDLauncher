import { requireTimeDataAccess } from "@/lib/auth/scope-check";
import { NextResponse } from "next/server";

// Distinct years that have at least one time-off request in the viewer's
// scope. Used by the summary tab to build a year-picker dropdown instead
// of a hardcoded reset-to-current-year button. Current year is always
// included so a manager with no historical data still has something to
// click.
export async function GET() {
  const gate = await requireTimeDataAccess(null, "view");
  if (!gate.ok) {
    return NextResponse.json({ years: [new Date().getFullYear()] });
  }
  const { supabase, scope } = gate;

  // Bookend the scope with min/max start_date rather than paging through
  // every row — two indexed lookups vs. a full scan.
  let base = supabase
    .from("time_off_requests")
    .select("start_date, profile:profiles!profile_id!inner(id)")
    .eq("profile.is_active", true);
  if (scope.department) base = base.eq("profile.department", scope.department);
  if (scope.office) base = base.eq("profile.office", scope.office);

  const [{ data: minRow }, { data: maxRow }] = await Promise.all([
    base.order("start_date", { ascending: true }).limit(1),
    base.order("start_date", { ascending: false }).limit(1),
  ]);

  const currentYear = new Date().getFullYear();
  const years = new Set<number>([currentYear]);
  const minYear = minRow?.[0]?.start_date ? Number(minRow[0].start_date.slice(0, 4)) : null;
  const maxYear = maxRow?.[0]?.start_date ? Number(maxRow[0].start_date.slice(0, 4)) : null;
  if (minYear && maxYear) {
    for (let y = minYear; y <= maxYear; y++) years.add(y);
  }

  return NextResponse.json({
    years: [...years].sort((a, b) => b - a),
  });
}
