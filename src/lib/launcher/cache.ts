// Server-side cache layer over the launcher config tables. Each table
// changes rarely (< 100 rows, edited by admins a few times a week), so
// pinning them behind unstable_cache with tag-based revalidation turns
// the highest-traffic route (/dashboard) into a zero-Supabase-round-trip
// render on cache hits. CRUD endpoints call revalidateTag() to bust.
//
// The 5-minute `revalidate` is a safety net for cases where a mutation
// forgets to fire revalidateTag — we take at most a 5-minute lag before
// the stale entry ages out on its own.

import { revalidateTag, unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserAccessRow } from "@/lib/launcher/access";
import {
  FALLBACK_DEPARTMENTS,
  FALLBACK_OFFICES,
  type OrgItem,
} from "@/lib/org/constants";
import type { LauncherApp, LauncherSection } from "@/types/app";
import type { ImportantLink } from "@/types/link";
import type { MotivationalQuote } from "@/types/quote";

const REVALIDATE_SECONDS = 300;

export const LAUNCHER_TAGS = {
  apps: "launcher-apps",
  roleAccess: "launcher-role-app-access",
  userAccess: "launcher-user-access",
  sections: "launcher-sections",
  links: "launcher-links",
  roles: "launcher-roles",
  offices: "launcher-offices",
  departments: "launcher-departments",
  activeQuote: "launcher-active-quote",
  // Not busted by any route — the View as people list lags up to a minute.
  previewUsers: "launcher-preview-users",
} as const;

interface RoleAccessRow {
  role_name: string;
  app_id: string;
  /** null = every office (migration 034). */
  office: string | null;
}

export const getCachedApps = unstable_cache(
  async (): Promise<LauncherApp[]> => {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("launcher_apps")
      .select("*")
      .eq("status", "active")
      .order("display_order", { ascending: true });
    return (data || []) as LauncherApp[];
  },
  // Key suffix bumped when stored office values are renamed (migration 039)
  // so a fresh deploy never serves rows cached under the old names.
  ["launcher-apps-v2"],
  { tags: [LAUNCHER_TAGS.apps], revalidate: REVALIDATE_SECONDS },
);

export const getCachedRoleAppAccess = unstable_cache(
  async (): Promise<RoleAccessRow[]> => {
    const supabase = createAdminClient();
    // select("*") so this works before and after migration 034 (office column).
    const { data } = await supabase.from("launcher_role_app_access").select("*");
    return ((data || []) as Array<RoleAccessRow & { office?: string | null }>).map((r) => ({
      role_name: r.role_name,
      app_id: r.app_id,
      office: r.office ?? null,
    }));
  },
  ["launcher-role-app-access-v2"],
  { tags: [LAUNCHER_TAGS.roleAccess], revalidate: REVALIDATE_SECONDS },
);

// Individual people on apps and links (migration 040). Empty until the
// migration is applied.
export const getCachedUserAccess = unstable_cache(
  async (): Promise<UserAccessRow[]> => {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("launcher_user_access")
      .select("profile_id, app_id, link_id");
    return (data || []) as UserAccessRow[];
  },
  ["launcher-user-access"],
  { tags: [LAUNCHER_TAGS.userAccess], revalidate: REVALIDATE_SECONDS },
);

export const getCachedSections = unstable_cache(
  async (): Promise<LauncherSection[]> => {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("launcher_sections")
      .select("*")
      .order("display_order", { ascending: true });
    return (data || []) as LauncherSection[];
  },
  ["launcher-sections"],
  { tags: [LAUNCHER_TAGS.sections], revalidate: REVALIDATE_SECONDS },
);

export const getCachedLinks = unstable_cache(
  async (): Promise<ImportantLink[]> => {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("launcher_links")
      .select("*")
      .order("display_order", { ascending: true });
    return (data || []) as ImportantLink[];
  },
  ["launcher-links"],
  { tags: [LAUNCHER_TAGS.links], revalidate: REVALIDATE_SECONDS },
);

export interface CachedRole {
  name: string;
  display_name: string;
  description: string | null;
  is_admin: boolean;
  /** Built-in role whose permissions this role gets (migration 051). */
  acts_as: string | null;
}

export const getCachedRoles = unstable_cache(
  async (): Promise<CachedRole[]> => {
    const supabase = createAdminClient();
    // select("*") so this works before and after migration 051 (acts_as).
    const { data } = await supabase.from("launcher_roles").select("*").order("name");
    return ((data || []) as Array<Omit<CachedRole, "acts_as"> & { acts_as?: string | null }>).map((r) => ({
      name: r.name,
      display_name: r.display_name,
      description: r.description ?? null,
      is_admin: !!r.is_admin,
      acts_as: r.acts_as ?? null,
    }));
  },
  // v3: acts_as added (migration 051).
  ["launcher-roles-v3"],
  { tags: [LAUNCHER_TAGS.roles], revalidate: REVALIDATE_SECONDS },
);

// Offices and departments (migration 051). Before the tables exist
// (PGRST205 from PostgREST, 42P01 from Postgres) the old hardcoded lists are
// served so deploy order doesn't matter. Other errors throw, so a transient
// failure is never cached; getOffices() / getDepartments() in
// src/lib/org/lists.ts fall back for that one request.
export function isMissingTable(code: string | undefined): boolean {
  return code === "PGRST205" || code === "42P01";
}

async function loadOrgList(table: string, fallback: readonly OrgItem[]): Promise<OrgItem[]> {
  const { data, error } = await createAdminClient()
    .from(table)
    .select("name, display_name, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    if (isMissingTable(error.code)) return [...fallback];
    throw new Error(`${table}: ${error.message}`);
  }
  return (data || []) as OrgItem[];
}

export const getCachedOffices = unstable_cache(
  () => loadOrgList("launcher_offices", FALLBACK_OFFICES),
  ["launcher-offices"],
  { tags: [LAUNCHER_TAGS.offices], revalidate: REVALIDATE_SECONDS },
);

export const getCachedDepartments = unstable_cache(
  () => loadOrgList("launcher_departments", FALLBACK_DEPARTMENTS),
  ["launcher-departments"],
  { tags: [LAUNCHER_TAGS.departments], revalidate: REVALIDATE_SECONDS },
);

export const getCachedActiveQuote = unstable_cache(
  async (): Promise<MotivationalQuote | null> => {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("launcher_motivational_quotes")
      .select("*")
      .eq("is_active", true)
      .maybeSingle();
    return (data as MotivationalQuote | null) ?? null;
  },
  ["launcher-active-quote"],
  { tags: [LAUNCHER_TAGS.activeQuote], revalidate: REVALIDATE_SECONDS },
);

// Called from CRUD endpoints after a mutation. Bumps every tag a change
// to that entity could invalidate — role edits, for example, could change
// which apps show up in the role-scoped list, so they invalidate both
// role-access AND the apps cache. Cheap to over-bust; broken to under-bust.
export type LauncherCacheKind =
  | "apps"
  | "sections"
  | "links"
  | "roles"
  | "quotes"
  | "offices"
  | "departments";
export function bustLauncherCache(kind: LauncherCacheKind): void {
  switch (kind) {
    case "apps":
      revalidateTag(LAUNCHER_TAGS.apps);
      revalidateTag(LAUNCHER_TAGS.roleAccess);
      revalidateTag(LAUNCHER_TAGS.userAccess);
      break;
    case "sections":
      revalidateTag(LAUNCHER_TAGS.sections);
      break;
    case "links":
      revalidateTag(LAUNCHER_TAGS.links);
      revalidateTag(LAUNCHER_TAGS.userAccess);
      break;
    case "roles":
      revalidateTag(LAUNCHER_TAGS.roles);
      revalidateTag(LAUNCHER_TAGS.roleAccess);
      break;
    case "quotes":
      revalidateTag(LAUNCHER_TAGS.activeQuote);
      break;
    case "offices":
      revalidateTag(LAUNCHER_TAGS.offices);
      break;
    case "departments":
      revalidateTag(LAUNCHER_TAGS.departments);
      break;
  }
}
