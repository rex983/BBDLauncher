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
import type { LauncherApp, LauncherSection } from "@/types/app";
import type { ImportantLink } from "@/types/link";
import type { MotivationalQuote } from "@/types/quote";

const REVALIDATE_SECONDS = 300;

export const LAUNCHER_TAGS = {
  apps: "launcher-apps",
  roleAccess: "launcher-role-app-access",
  sections: "launcher-sections",
  links: "launcher-links",
  roles: "launcher-roles",
  activeQuote: "launcher-active-quote",
} as const;

interface RoleAccessRow {
  role_name: string;
  app_id: string;
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
  ["launcher-apps"],
  { tags: [LAUNCHER_TAGS.apps], revalidate: REVALIDATE_SECONDS },
);

export const getCachedRoleAppAccess = unstable_cache(
  async (): Promise<RoleAccessRow[]> => {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("launcher_role_app_access")
      .select("role_name, app_id");
    return (data || []) as RoleAccessRow[];
  },
  ["launcher-role-app-access"],
  { tags: [LAUNCHER_TAGS.roleAccess], revalidate: REVALIDATE_SECONDS },
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

export const getCachedRoles = unstable_cache(
  async (): Promise<{ name: string; display_name: string }[]> => {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("launcher_roles")
      .select("name, display_name")
      .order("name");
    return (data || []) as { name: string; display_name: string }[];
  },
  ["launcher-roles"],
  { tags: [LAUNCHER_TAGS.roles], revalidate: REVALIDATE_SECONDS },
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
export type LauncherCacheKind = "apps" | "sections" | "links" | "roles" | "quotes";
export function bustLauncherCache(kind: LauncherCacheKind): void {
  switch (kind) {
    case "apps":
      revalidateTag(LAUNCHER_TAGS.apps);
      revalidateTag(LAUNCHER_TAGS.roleAccess);
      break;
    case "sections":
      revalidateTag(LAUNCHER_TAGS.sections);
      break;
    case "links":
      revalidateTag(LAUNCHER_TAGS.links);
      break;
    case "roles":
      revalidateTag(LAUNCHER_TAGS.roles);
      revalidateTag(LAUNCHER_TAGS.roleAccess);
      break;
    case "quotes":
      revalidateTag(LAUNCHER_TAGS.activeQuote);
      break;
  }
}
