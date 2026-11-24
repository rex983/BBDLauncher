import { NextRequest, NextResponse } from "next/server";
import { requireTimeDataAccess } from "@/lib/auth/scope-check";

// Remove a company holiday. Its date goes back to counting as a normal day
// in every time-off total.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireTimeDataAccess(null, "edit");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const { error } = await gate.supabase.from("company_holidays").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
