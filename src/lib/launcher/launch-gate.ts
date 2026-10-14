import type { Session } from "next-auth";
import { rowsAllow } from "@/lib/launcher/access";
import {
  getCachedApps,
  getCachedRoleAppAccess,
  getCachedUserAccess,
} from "@/lib/launcher/cache";
import { isClockedIn } from "@/lib/timesheets/server";

export interface LaunchApp {
  id: string;
  name: string;
  url: string;
  sso_type: string;
  offices: string[] | null;
}

export type LaunchDenied = "clock_required" | "forbidden" | "not_found";

/** Who is launching: the signed-in user, or the person an admin views as. */
export type LaunchSubject = Pick<Session["user"], "profileId" | "role" | "office">;

// Everything that decides whether this user may sign into this app. Shared by
// /api/launch (the tile click) and /api/saml/sso (SP-initiated SAML), so a
// signed login is never issued on a looser rule than the dashboard uses.
//
// Callers must have just called auth(): its jwt callback already refused
// deactivated or signed-out people (profiles.is_active / signed_out_at), so
// that read isn't repeated here. Apps, the role grid and personal grants come
// from the same tag-busted caches the dashboard renders from; only the clock
// state is read live.
//
// For an admin's "View as", the subject is the previewed person and
// skipClock is set: the admin is the one launching, so their clock (none —
// admins bypass it) applies, not the person's.
export async function checkAppLaunch(
  subject: LaunchSubject,
  appId: string,
  opts: { skipClock?: boolean } = {},
): Promise<{ ok: true; app: LaunchApp } | { ok: false; reason: LaunchDenied }> {
  const isAdmin = subject.role === "admin";

  const [clockedIn, apps, roleAccess, userAccess] = await Promise.all([
    // Clock gate: admins bypass so they can debug apps outside work hours.
    isAdmin || opts.skipClock ? true : isClockedIn(subject.profileId),
    getCachedApps(),
    getCachedRoleAppAccess(),
    getCachedUserAccess(),
  ]);

  // getCachedApps only holds active apps, matching the old status filter.
  const found = apps.find((a) => a.id === appId);
  const app: LaunchApp | null = found
    ? {
        id: found.id,
        name: found.name,
        url: found.url,
        sso_type: found.sso_type,
        offices: found.offices ?? null,
      }
    : null;
  const accessRows = roleAccess.filter(
    (r) => r.app_id === appId && r.role_name === subject.role,
  );
  const personal = userAccess.some(
    (r) => r.profile_id === subject.profileId && r.app_id === appId,
  );

  if (!clockedIn) return { ok: false, reason: "clock_required" };

  // Office × role grid (migration 034): the user's role must be allowed from
  // their office. Admins still need an admin row but aren't limited by office.
  // People added to the app by name (migration 040) skip both office gates.
  if (!personal && !rowsAllow(accessRows, subject.role, subject.office, isAdmin)) {
    return { ok: false, reason: "forbidden" };
  }

  if (!app) return { ok: false, reason: "not_found" };

  // Legacy office gate: the grid already encodes each app's office list (migration
  // 034) and saving an app's grid clears it; kept so old and new code always agree.
  const appOffices: string[] = Array.isArray(app.offices) ? app.offices : [];
  if (
    appOffices.length > 0 &&
    !personal &&
    !isAdmin &&
    (!subject.office || !appOffices.includes(subject.office))
  ) {
    return { ok: false, reason: "forbidden" };
  }

  return { ok: true, app };
}
