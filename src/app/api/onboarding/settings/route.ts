import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validationError } from "@/app/api/_lib/validation";
import { requireAdmin } from "@/lib/auth/require-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTagIds } from "@/lib/onboarding/service";

// Who gets the Slack tag + bell when a manager submits a new hire. Admins only.

export async function GET() {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  return NextResponse.json({ tag_profile_ids: await getTagIds() });
}

const putSchema = z.object({ tag_profile_ids: z.array(z.string().uuid()).max(50) });

export async function PUT(req: NextRequest) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const parsed = putSchema.safeParse(await req.json());
  if (!parsed.success) return validationError(parsed.error);
  const ids = [...new Set(parsed.data.tag_profile_ids)];
  const { error } = await createAdminClient()
    .from("onboarding_settings")
    .upsert({ id: 1, tag_profile_ids: ids });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tag_profile_ids: ids });
}
