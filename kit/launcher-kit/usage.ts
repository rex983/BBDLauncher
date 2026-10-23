import { auth } from "@/auth";
import { adminClient, APP_AUDIENCE } from "./config";

// Active-minutes heartbeat, the server half of usage-beacon.tsx. Each app's
// src/app/api/launcher-usage/route.ts is just:
//
//   export { POST } from "@/lib/launcher-kit/usage";
//
// Records one minute of use for the signed-in person in this app
// (pm_record_usage dedupes per minute). "View as" sessions are never counted.
// Always answers 204: usage must never break a page.

export async function POST(): Promise<Response> {
  const done = new Response(null, { status: 204 });
  try {
    const session = await auth();
    const profileId = session?.user?.profileId;
    if (!profileId || session.viewAs) return done;
    const { error } = await adminClient().rpc("pm_record_usage", {
      p_profile_id: profileId,
      p_audience: APP_AUDIENCE,
    });
    if (error) console.warn(`[launcher-kit] pm_record_usage failed (${error.code})`);
  } catch (e) {
    console.warn(`[launcher-kit] pm_record_usage threw: ${String(e)}`);
  }
  return done;
}
