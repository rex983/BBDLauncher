import type { Session } from "next-auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rowsAllow } from "@/lib/launcher/access";
import { hasPersonalAppGrant } from "@/lib/launcher/user-access";
import { isClockedIn } from "@/lib/timesheets/server";

export interface LaunchApp {
  id: string;
  name: string;
  url: string;
  sso_type: string;
  offices: string[] | null;
}

export type LaunchDenied = "deactivated" | "clock_required" | "forbidden" | "not_found";

// Everything that decides whether this user may sign into this app. Shared by
// /api/launch (the tile click) and /api/saml/sso (SP-initiated SAML), so a
// signed login is never issued on a looser rule than the dashboard uses.
export async function checkAppLaunch(
  supabase: SupabaseClient,
  session: Session,
  appId: string,
): Promise<{ ok: true; app: LaunchApp } | { ok: false; reason: LaunchDenied }> {
  const isAdmin = session.user.role === "admin";

  // An inactive user shouldn't mint fresh tokens even if their launcher JWT
  // hasn't ticked over yet. The jwt callback also ejects them.
  const { data: viewer } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", session.user.profileId)
    .single();
  if (viewer?.is_active === false) return { ok: false, reason: "deactivated" };

  // Clock gate: admins bypass so they can debug apps outside work hours.
  if (!isAdmin && !(await isClockedIn(session.user.profileId))) {
    return { ok: false, reason: "clock_required" };
  }

  // Office × role grid (migration 034): the user's role must be allowed from
  // their office. Admins still need an admin row but aren't limited by office.
  const { data: accessRows } = await supabase
    .from("launcher_role_app_access")
    .select("*")
    .eq("app_id", appId)
    .eq("role_name", session.user.role);
  const rows = ((accessRows || []) as Array<{ role_name: string; app_id: string; office?: string | null }>).map((r) => ({
    ...r,
    office: r.office ?? null,
  }));

  // People added to the app by name (migration 040) skip both office gates.
  const personal = await hasPersonalAppGrant(session.user.profileId, appId);
  if (!personal && !rowsAllow(rows, session.user.role, session.user.office, isAdmin)) {
    return { ok: false, reason: "forbidden" };
  }

  const { data: app } = await supabase
    .from("launcher_apps")
    .select("id, name, url, sso_type, offices")
    .eq("id", appId)
    .eq("status", "active")
    .single<LaunchApp>();
  if (!app) return { ok: false, reason: "not_found" };

  // Legacy office gate: the grid already encodes each app's office list (migration
  // 034) and saving an app's grid clears it; kept so old and new code always agree.
  const appOffices: string[] = Array.isArray(app.offices) ? app.offices : [];
  if (
    appOffices.length > 0 &&
    !personal &&
    !isAdmin &&
    (!session.user.office || !appOffices.includes(session.user.office))
  ) {
    return { ok: false, reason: "forbidden" };
  }

  return { ok: true, app };
}
