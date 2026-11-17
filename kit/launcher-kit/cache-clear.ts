import { revalidatePath } from "next/cache";
import { APP_AUDIENCE } from "./config";
import { forgetRecentChecks } from "./session";
import { verifyLauncherCacheClear } from "./verifier";

// "Clear cache" from the launcher (Admin → Clear Cache). Each app exposes
//
//   // src/app/api/launcher-cache/route.ts
//   export const POST = cacheClearRoute([forgetMyInMemoryThing]);
//
// and lists "/api/launcher-cache" in its proxy's public paths: the launcher
// calls it server to server with a signed token, never a browser session.
//
// What one call clears:
//   - every unstable_cache / fetch cache entry in the app (shared by all
//     servers): the next read of each goes back to the source;
//   - the 60s launcher recheck memo, so role and access changes apply on
//     the next request;
//   - whatever in-memory caches the app passes in.
// In-memory caches live per server. The call reaches one server; any other
// keeps its copy until its own short timer runs out.

export function cacheClearRoute(clearMemory: Array<() => void> = []) {
  return async function POST(req: Request): Promise<Response> {
    const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
    if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      await verifyLauncherCacheClear(token);
    } catch {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Every route's cached data carries the root layout's tag, so this
    // expires all of it at once, tagged or not.
    revalidatePath("/", "layout");
    forgetRecentChecks();
    const failed: string[] = [];
    for (const clear of clearMemory) {
      try {
        clear();
      } catch (e) {
        failed.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (failed.length) console.error(`[launcher-kit] cache clear: ${failed.join("; ")}`);
    return Response.json({ ok: failed.length === 0, app: APP_AUDIENCE, failed });
  };
}
