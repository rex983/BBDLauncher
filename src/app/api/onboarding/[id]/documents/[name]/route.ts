import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { closedError, getRequest, ONBOARDING_BUCKET, requireOnboardingUser } from "@/lib/onboarding/service";

type Params = { params: Promise<{ id: string; name: string }> };

// Object names are {uuid}-{safe name}; anything else can't be ours.
const SAFE = /^[0-9a-f-]{36}-[A-Za-z0-9._-]+$/;

async function resolve(params: Params["params"]) {
  const session = await requireOnboardingUser();
  if (session instanceof NextResponse) return session;
  const { id, name } = await params;
  if (!SAFE.test(name)) return NextResponse.json({ error: "Invalid file" }, { status: 400 });
  const request = await getRequest(session, id);
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return { path: `${id}/${name}`, filename: name.slice(37), request };
}

// Short-lived signed link, so the file is never public.
export async function GET(_req: NextRequest, { params }: Params) {
  const r = await resolve(params);
  if (r instanceof NextResponse) return r;
  const { data, error } = await createAdminClient()
    .storage.from(ONBOARDING_BUCKET)
    .createSignedUrl(r.path, 60, { download: r.filename });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, 302);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const r = await resolve(params);
  if (r instanceof NextResponse) return r;
  const closed = closedError(r.request);
  if (closed) return closed;
  const { error } = await createAdminClient().storage.from(ONBOARDING_BUCKET).remove([r.path]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
