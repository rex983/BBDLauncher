// Read and replace the individual people on an app or link (migration 040).
// Server-only — callers bust the launcher cache afterwards.

import { createAdminClient } from "@/lib/supabase/admin";

type Target = "app_id" | "link_id";

/** target id → profile ids, for the admin lists. */
export async function userIdsByTarget(target: Target, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("launcher_user_access")
    .select(`profile_id, ${target}`)
    .in(target, ids);
  for (const r of (data || []) as unknown as Array<Record<Target, string> & { profile_id: string }>) {
    const list = out.get(r[target]) ?? [];
    list.push(r.profile_id);
    out.set(r[target], list);
  }
  return out;
}

/** Replace the people on one app or link. Returns an error message on failure. */
export async function setUserIds(target: Target, id: string, profileIds: string[]): Promise<string | null> {
  const supabase = createAdminClient();
  const { error: delError } = await supabase.from("launcher_user_access").delete().eq(target, id);
  if (delError) return delError.message;
  const unique = [...new Set(profileIds)];
  if (!unique.length) return null;
  const { error } = await supabase
    .from("launcher_user_access")
    .insert(unique.map((profile_id) => ({ profile_id, [target]: id })));
  return error?.message ?? null;
}

/** Does this person have a personal grant on the app? */
export async function hasPersonalAppGrant(profileId: string, appId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("launcher_user_access")
    .select("id")
    .eq("profile_id", profileId)
    .eq("app_id", appId)
    .maybeSingle();
  return !!data;
}
