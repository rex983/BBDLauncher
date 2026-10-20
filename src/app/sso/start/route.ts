import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeNextPath } from "@/lib/sso/next-path";
import { NextRequest, NextResponse } from "next/server";

const AUDIENCE = /^[a-z0-9-]{1,64}$/;

/**
 * Where a JWT app sends someone who isn't signed in to it (launcher kit,
 * `launcherSignInUrl`): /sso/start?app=<jwt_audience>&next=<path in the app>.
 *
 *  - Signed in here: straight on to /api/launch, which checks access and
 *    returns them to the app's /sso/callback (then `next`) — no prompt.
 *  - Not signed in: back to the app's /login?signedOut=1, which shows one
 *    "Sign in on the launcher" button. That button comes back here with
 *    login=1, which signs them in on the launcher first and then carries on.
 *
 * Public in middleware: it decides about the session itself.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const audience = sp.get("app") ?? "";
  if (!AUDIENCE.test(audience)) {
    return NextResponse.json({ error: "Unknown application" }, { status: 404 });
  }
  const next = safeNextPath(sp.get("next"));

  const { data: config } = await createAdminClient()
    .from("launcher_sso_configs")
    .select("app_id, jwt_acs_url")
    .eq("jwt_audience", audience)
    .limit(1)
    .maybeSingle();
  if (!config?.jwt_acs_url || !/^https?:\/\//i.test(config.jwt_acs_url)) {
    return NextResponse.json({ error: "Unknown application" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user) {
    if (sp.get("login") === "1") {
      const back = new URLSearchParams({ app: audience });
      if (next) back.set("next", next);
      const login = new URL("/login", req.url);
      login.searchParams.set("callbackUrl", `/sso/start?${back}`);
      return NextResponse.redirect(login);
    }
    const appLogin = new URL("/login", config.jwt_acs_url);
    appLogin.searchParams.set("signedOut", "1");
    if (next) appLogin.searchParams.set("callbackUrl", next);
    return NextResponse.redirect(appLogin);
  }

  const launch = new URL(`/api/launch/${config.app_id}`, req.url);
  launch.searchParams.set("from", "app");
  if (next) launch.searchParams.set("next", next);
  return NextResponse.redirect(launch);
}
