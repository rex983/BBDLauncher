import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { validationError } from "@/app/api/_lib/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  copyTemplateTo,
  getRequest,
  listRequests,
  notifyOpened,
  purgeRequest,
  requireOnboardingUser,
} from "@/lib/onboarding/service";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "pick a date");

const createSchema = z.object({
  first_name: z.string().trim().min(1, "required").max(100),
  last_name: z.string().trim().min(1, "required").max(100),
  hire_date: day,
  dob: day.refine((d) => d < new Date().toISOString().slice(0, 10), "must be in the past"),
});

export async function GET() {
  const session = await requireOnboardingUser();
  if (session instanceof NextResponse) return session;
  return NextResponse.json(await listRequests(session));
}

// A manager (or admin) opens a request. Documents are uploaded afterwards,
// one per call, to /api/onboarding/[id]/documents.
export async function POST(req: NextRequest) {
  const session = await requireOnboardingUser();
  if (session instanceof NextResponse) return session;

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return validationError(parsed.error);

  const { data, error } = await createAdminClient()
    .from("onboarding_requests")
    .insert({
      ...parsed.data,
      created_by: session.user.profileId,
      created_by_name: session.user.name || session.user.email,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    await copyTemplateTo(data.id);
  } catch (e) {
    await purgeRequest(data.id).catch(() => undefined);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't save" }, { status: 500 });
  }

  const created = await getRequest(session, data.id);
  if (created) {
    after(() =>
      notifyOpened(created, session.user.profileId).catch((e) => console.error("[onboarding] notify failed:", e)),
    );
  }
  return NextResponse.json({ id: data.id }, { status: 201 });
}
