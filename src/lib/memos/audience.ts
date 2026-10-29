// Audience resolution for memos. Given a memo's audience_scope and
// filters, return the set of profile IDs that should receive it.
//
// Snapshot semantics: this runs at publish time, and the resulting list
// is materialized into office_memo_recipients rows. New hires joining
// after publish are not retroactively added — deliberate, since a memo
// dated pre-hire may not apply to them.
//
// People on an "apps only" role (migration 062, e.g. trainees) never get
// memos: they can't open the memos pages.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoAudienceScope } from "@/lib/memos/types";

export interface AudienceResolution {
  profileIds: string[];
  audienceLabel: string; // human-readable summary for Slack + audit
}

export async function resolveMemoAudience(params: {
  supabase: SupabaseClient;
  scope: MemoAudienceScope;
  office: string | null;
  department: string | null;
  customProfileIds: string[];
}): Promise<AudienceResolution> {
  const { supabase, scope, office, department, customProfileIds } = params;
  const appsOnlyRoles = await loadAppsOnlyRoles(supabase);

  if (scope === "custom") {
    // De-dup and validate the custom list exists + is active.
    const unique = Array.from(new Set(customProfileIds));
    if (unique.length === 0) {
      return { profileIds: [], audienceLabel: "Custom (empty)" };
    }
    const { data } = await supabase
      .from("profiles")
      .select("id, role")
      .in("id", unique)
      .eq("is_active", true);
    const ids = withoutAppsOnly(data, appsOnlyRoles);
    return {
      profileIds: ids,
      audienceLabel: `Custom list (${ids.length} recipient${ids.length === 1 ? "" : "s"})`,
    };
  }

  let query = supabase.from("profiles").select("id, role").eq("is_active", true);
  let label: string;

  if (scope === "company") {
    label = "Whole company";
  } else if (scope === "office") {
    if (!office) return { profileIds: [], audienceLabel: "Office (missing)" };
    query = query.eq("office", office);
    label = `Office · ${office}`;
  } else if (scope === "department") {
    if (!department) {
      return { profileIds: [], audienceLabel: "Department (missing)" };
    }
    query = query.eq("department", department);
    if (office) {
      query = query.eq("office", office);
      label = `Department · ${department} @ ${office}`;
    } else {
      label = `Department · ${department}`;
    }
  } else {
    return { profileIds: [], audienceLabel: "Unknown scope" };
  }

  const { data } = await query;
  const ids = withoutAppsOnly(data, appsOnlyRoles);
  return { profileIds: ids, audienceLabel: label };
}

async function loadAppsOnlyRoles(supabase: SupabaseClient): Promise<Set<string>> {
  // select("*") so this works before migration 062 adds the column.
  const { data } = await supabase.from("launcher_roles").select("*");
  return new Set(
    ((data || []) as Array<{ name: string; apps_only?: boolean | null }>)
      .filter((r) => r.apps_only)
      .map((r) => r.name),
  );
}

function withoutAppsOnly(
  rows: Array<{ id: unknown; role?: unknown }> | null,
  appsOnlyRoles: Set<string>,
): string[] {
  return (rows || [])
    .filter((r) => !appsOnlyRoles.has(r.role as string))
    .map((r) => r.id as string);
}
