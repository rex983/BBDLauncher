import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cached a minute at the browser and the CDN, so a new photo reaches every
// app within a couple of minutes without a database read per <img>.
const CACHE = "public, max-age=60, s-maxage=60, stale-while-revalidate=300";

// GET /api/avatar/<profile_id> — public (no session), used as an <img> src
// by every BBD app (kit launcher-avatar.tsx). Redirects to the person's
// current photo; 404 when they have none, so the app shows initials.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  if (!UUID.test(profileId)) return new NextResponse(null, { status: 404, headers: { "Cache-Control": CACHE } });

  const { data } = await createAdminClient()
    .from("profiles")
    .select("avatar_url")
    .eq("id", profileId)
    .maybeSingle();
  const url = data?.avatar_url as string | null | undefined;
  if (!url) return new NextResponse(null, { status: 404, headers: { "Cache-Control": CACHE } });

  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": CACHE } });
}
