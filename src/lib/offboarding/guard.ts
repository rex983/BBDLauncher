import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Closed cases are read-only — reopen first. Returns an error response, or
// the case's employee fields for routes that need them.
export async function requireOpenCase(
  caseId: string,
): Promise<NextResponse | { profile_id: string | null; employee_name: string | null; employee_email: string }> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("offboarding_cases")
    .select("status, profile_id, employee_name, employee_email")
    .eq("id", caseId)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (data.status !== "open") {
    return NextResponse.json({ error: "This case is closed. Reopen it to make changes." }, { status: 409 });
  }
  return data;
}
