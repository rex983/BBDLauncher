import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCacheClearToken } from "@/lib/sso/jwt-issuer";

// Admin → Clear Cache. The launcher clears its own cached reads directly and
// asks each app to clear its own at POST <app>/api/launcher-cache (the kit's
// cacheClearRoute), with a short-lived token signed by the sign-in key.

/** The id used for the launcher itself in targets and results. */
export const LAUNCHER_TARGET_ID = "launcher";

export interface CacheTarget {
  /** launcher_apps.id, or LAUNCHER_TARGET_ID. */
  id: string;
  name: string;
  /** Where the request goes: the app's origin. Empty for the launcher. */
  origin: string;
}

export interface CacheClearResult {
  id: string;
  name: string;
  ok: boolean;
  ms: number;
  /** Why it failed, in words an admin can act on. Empty when ok. */
  detail: string;
}

interface AppTarget extends CacheTarget {
  audience: string;
}

const TIMEOUT_MS = 15_000;

/** Every app that signs in through the launcher (it has a JWT audience and URL). */
async function appTargets(): Promise<AppTarget[]> {
  const supabase = createAdminClient();
  const [configs, apps] = await Promise.all([
    supabase.from("launcher_sso_configs").select("app_id, jwt_acs_url, jwt_audience"),
    supabase.from("launcher_apps").select("id, name"),
  ]);
  if (configs.error) throw new Error(`launcher_sso_configs: ${configs.error.message}`);
  if (apps.error) throw new Error(`launcher_apps: ${apps.error.message}`);
  const names = new Map((apps.data ?? []).map((a) => [a.id as string, a.name as string]));

  const out: AppTarget[] = [];
  for (const c of configs.data ?? []) {
    const name = names.get(c.app_id);
    if (!name || !c.jwt_audience || !c.jwt_acs_url) continue;
    let origin: string;
    try {
      const url = new URL(c.jwt_acs_url);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      origin = url.origin;
    } catch {
      continue;
    }
    out.push({ id: c.app_id, name, origin, audience: c.jwt_audience });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The launcher first, then the apps by name. */
export async function listCacheTargets(): Promise<CacheTarget[]> {
  const apps = await appTargets();
  return [
    { id: LAUNCHER_TARGET_ID, name: "BBD Launcher", origin: "" },
    ...apps.map(({ id, name, origin }) => ({ id, name, origin })),
  ];
}

function clearLauncher(): CacheClearResult {
  const started = Date.now();
  // Every cached read in the launcher carries the root layout's tag, so this
  // expires all of them: apps, sections, links, roles, access, the quote and
  // the session profile.
  revalidatePath("/", "layout");
  return { id: LAUNCHER_TARGET_ID, name: "BBD Launcher", ok: true, ms: Date.now() - started, detail: "" };
}

async function clearApp(t: AppTarget): Promise<CacheClearResult> {
  const started = Date.now();
  const done = (ok: boolean, detail: string): CacheClearResult => ({
    id: t.id,
    name: t.name,
    ok,
    ms: Date.now() - started,
    detail,
  });
  try {
    const token = await generateCacheClearToken(t.audience);
    const res = await fetch(`${t.origin}/api/launcher-cache`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { ok?: boolean; failed?: string[] } | null;
      if (body?.ok === false) return done(false, `Partly cleared: ${(body.failed ?? []).join("; ")}`);
      return done(true, "");
    }
    // An app without the endpoint answers 404/405, or its sign-in redirect.
    if (res.status === 404 || res.status === 405 || (res.status >= 300 && res.status < 400)) {
      return done(false, "This app doesn't support clearing from the launcher yet.");
    }
    if (res.status === 401) return done(false, "The app refused the launcher's request (401).");
    return done(false, `The app answered ${res.status}.`);
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return done(false, timedOut ? "No answer within 15 seconds." : "Couldn't reach the app.");
  }
}

/**
 * Clears one target (an app id or LAUNCHER_TARGET_ID) or, with "all",
 * everything at once. Returns null when the target isn't known.
 */
export async function clearCaches(target: string): Promise<CacheClearResult[] | null> {
  if (target === LAUNCHER_TARGET_ID) return [clearLauncher()];
  const apps = await appTargets();
  if (target === "all") {
    const results = await Promise.all(apps.map(clearApp));
    return [clearLauncher(), ...results];
  }
  const app = apps.find((a) => a.id === target);
  return app ? [await clearApp(app)] : null;
}
