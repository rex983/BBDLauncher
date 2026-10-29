import { auth } from "@/auth";
import { adminClient, APP_AUDIENCE } from "./config";

// "Currently viewing", the server half of presence-avatars.tsx. Each app's
// src/app/api/launcher-presence/route.ts is just:
//
//   export { POST } from "@/lib/launcher-kit/presence";
//
// Body: { tab, path, idle?, leave? }. Records this tab and answers with the
// other people with this app open: { people: [{ id, name, samePage, idle, path }] }
// (idle = no input for 5 min or the tab is in the background; path = the page
// they're on, so clicking their avatar takes you there; launcher migration 061,
// null before it).
// "View as" sessions are never recorded. Errors answer an empty list.

export type PresencePerson = { id: string; name: string; samePage: boolean; idle: boolean; path: string | null };

const empty = () => Response.json({ people: [] as PresencePerson[] });

export async function POST(req: Request): Promise<Response> {
  try {
    const session = await auth();
    const profileId = session?.user?.profileId;
    if (!profileId || session.viewAs) return empty();

    const body = (await req.json().catch(() => null)) as
      | { tab?: unknown; path?: unknown; idle?: unknown; leave?: unknown }
      | null;
    const tab = typeof body?.tab === "string" ? body.tab.slice(0, 64) : "";
    const path = typeof body?.path === "string" ? body.path.slice(0, 512) : "/";
    if (!tab) return empty();

    const { data, error } = await adminClient().rpc("launcher_presence_ping", {
      p_profile_id: profileId,
      p_audience: APP_AUDIENCE,
      p_tab_id: tab,
      p_path: path,
      p_idle: body?.idle === true,
      p_leave: body?.leave === true,
    });
    if (error) {
      console.warn(`[launcher-kit] launcher_presence_ping failed (${error.code})`);
      return empty();
    }
    const rows = (data ?? []) as { profile_id: string; name: string; same_page: boolean; idle: boolean; path?: string | null }[];
    return Response.json({
      people: rows.map((r) => ({
        id: r.profile_id,
        name: r.name,
        samePage: r.same_page,
        idle: r.idle,
        // Only in-app paths, so a click can never leave the app.
        path: typeof r.path === "string" && r.path.startsWith("/") && !r.path.startsWith("//") ? r.path : null,
      })),
    });
  } catch (e) {
    console.warn(`[launcher-kit] launcher_presence_ping threw: ${String(e)}`);
    return empty();
  }
}
