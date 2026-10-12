// The /admin/apps list: every app (any status) with its access grid, people
// and — for admins only — its sign-on settings. Shared by GET /api/apps and
// the admin page's server render so both return exactly the same shape.

import { createAdminClient } from "@/lib/supabase/admin";
import { cellsFromRows, officesWithAccess } from "@/lib/launcher/access";
import { getCachedRoleAppAccess, getCachedUserAccess } from "@/lib/launcher/cache";
import type { AppWithAccess } from "@/types/app";

export async function loadAdminApps(
  viewerIsAdmin: boolean,
): Promise<{ data: AppWithAccess[]; error: string | null }> {
  const supabase = createAdminClient();

  // One stage: the access grid and people come from the launcher cache (app
  // CRUD busts both), and SSO configs don't need the app ids up front.
  // Sign-on settings (including OAuth client secrets) are admin-only.
  const [appsRes, accessRows, userAccessRows, ssoRes] = await Promise.all([
    supabase.from("launcher_apps").select("*").order("display_order", { ascending: true }),
    getCachedRoleAppAccess(),
    getCachedUserAccess(),
    viewerIsAdmin
      ? supabase.from("launcher_sso_configs").select("*")
      : Promise.resolve({ data: [] as { app_id: string }[] }),
  ]);
  if (appsRes.error) return { data: [], error: appsRes.error.message };

  const rowsByAppId = new Map<string, Array<{ role_name: string; office: string | null }>>();
  for (const a of accessRows) {
    const list = rowsByAppId.get(a.app_id) ?? [];
    list.push({ role_name: a.role_name, office: a.office });
    rowsByAppId.set(a.app_id, list);
  }
  const usersByAppId = new Map<string, string[]>();
  for (const u of userAccessRows) {
    if (!u.app_id) continue;
    const list = usersByAppId.get(u.app_id) ?? [];
    list.push(u.profile_id);
    usersByAppId.set(u.app_id, list);
  }
  const ssoByAppId = new Map<string, unknown>();
  for (const c of (ssoRes.data || []) as { app_id: string }[]) ssoByAppId.set(c.app_id, c);

  const data = (appsRes.data || []).map((app) => ({
    ...app,
    roles: [...new Set((rowsByAppId.get(app.id) || []).map((r) => r.role_name))],
    access: cellsFromRows(rowsByAppId.get(app.id) || []),
    access_offices: officesWithAccess(rowsByAppId.get(app.id) || []),
    user_ids: usersByAppId.get(app.id) || [],
    sso_config: ssoByAppId.get(app.id) || null,
  })) as AppWithAccess[];
  return { data, error: null };
}
