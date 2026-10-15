import { createAdminClient } from "@/lib/supabase/admin";

// Office analytics: the server half of src/components/analytics-tracker.tsx.
// A copy of BBDLauncher/kit/launcher-kit/track.ts (the kit is for the other
// apps; the launcher doesn't import it); keep the two in sync. src/app/api/track/route.ts maps this
// app's session onto TrackSession and calls handleTrack.
//
// Rows go to bbd_events (shared DB, service role) tagged with this app's
// audience; the analytics app (bbd-analytics) reads them. "View as" sessions
// are never logged. Failures are swallowed: tracking must never break a page.

const APP_AUDIENCE = "launcher";

export interface TrackSession {
  user?: { email?: string | null; profileId?: string | null; office?: string | null } | null;
  viewAs?: unknown;
}

const MAX_BATCH = 50;
const str = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : null);

export async function handleTrack(req: Request, session: TrackSession | null): Promise<Response> {
  const done = new Response(null, { status: 204 });
  if (!session?.user?.email || session.viewAs) return done;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad batch", { status: 400 });
  }
  if (!Array.isArray(body)) return new Response("Bad batch", { status: 400 });

  const rows = body.slice(0, MAX_BATCH).flatMap((e: Record<string, unknown>) => {
    if (!e || (e.type !== "view" && e.type !== "click")) return [];
    const path = str(e.path, 500);
    if (!path) return [];
    const secs = typeof e.seconds === "number" && Number.isFinite(e.seconds) ? Math.round(e.seconds) : null;
    return [
      {
        app: APP_AUDIENCE,
        profile_id: session.user?.profileId || null,
        email: session.user?.email?.toLowerCase() ?? null,
        office: session.user?.office ?? null,
        type: e.type,
        path,
        label: str(e.label, 200),
        target: str(e.target, 500),
        seconds: secs != null && secs >= 0 && secs <= 86_400 ? secs : null,
      },
    ];
  });
  if (!rows.length) return done;

  try {
    const { error } = await createAdminClient().from("bbd_events").insert(rows);
    if (error) console.warn(`[analytics] track insert failed (${error.code})`);
  } catch (err) {
    console.warn("[analytics] track insert failed", err);
  }
  return done;
}
