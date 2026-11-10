import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validationError } from "@/app/api/_lib/validation";
import { requireAdmin } from "@/lib/auth/require-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTemplate, syncOpenRequests } from "@/lib/onboarding/service";

// The default checklist for onboarding requests. Admins only; every change
// also updates open requests (syncOpenRequests).

export async function GET() {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  return NextResponse.json(await getTemplate());
}

const addSchema = z.object({ title: z.string().trim().min(1, "required").max(200) });

// "Add task": appended to the end of the list.
export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const parsed = addSchema.safeParse(await req.json());
  if (!parsed.success) return validationError(parsed.error);

  const supabase = createAdminClient();
  const { data: last } = await supabase
    .from("onboarding_template_tasks")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase
    .from("onboarding_template_tasks")
    .insert({ title: parsed.data.title, position: (last?.position ?? -1) + 1 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await syncOpenRequests();
  return NextResponse.json(await getTemplate(), { status: 201 });
}
