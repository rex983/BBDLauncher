import { createAdminClient } from "@/lib/supabase/admin";

// Handbook editors: admins and senior/junior managers can always edit the
// handbook; anyone else needs a handbook_editor row, granted here by an admin.

/** Is this person granted editing (beyond their role)? */
export async function readHandbookEditor(profileId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("handbook_editor")
    .select("profile_id")
    .eq("profile_id", profileId)
    .maybeSingle();
  return !error && !!data;
}

/** The handbook's launcher app (by its SSO audience). */
async function handbookAppId(): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("launcher_sso_configs")
    .select("app_id")
    .eq("jwt_audience", "bbd-handbook")
    .limit(1)
    .maybeSingle();
  return (data?.app_id as string | undefined) ?? null;
}

/**
 * Grant or remove editing. Granting also gives the person their own access
 * to the handbook tile (an editor who can't open it is no use). Removing
 * leaves that access alone, so a grant made on purpose isn't undone.
 * Returns whether tile access was added.
 */
export async function setHandbookEditor(
  profileId: string,
  allowed: boolean,
  actorName: string,
): Promise<{ ok: true; accessAdded: boolean } | { ok: false; error: string }> {
  const db = createAdminClient();
  if (!allowed) {
    const { error } = await db.from("handbook_editor").delete().eq("profile_id", profileId);
    return error ? { ok: false, error: "Couldn't update editing." } : { ok: true, accessAdded: false };
  }
  const { error } = await db
    .from("handbook_editor")
    .upsert({ profile_id: profileId, granted_by_name: actorName }, { onConflict: "profile_id", ignoreDuplicates: true });
  if (error) return { ok: false, error: "Couldn't update editing." };

  const appId = await handbookAppId();
  if (!appId) return { ok: true, accessAdded: false };
  const { data: canOpen } = await db.rpc("launcher_can_open_app", { p_profile_id: profileId, p_audience: "bbd-handbook" });
  if (canOpen === true) return { ok: true, accessAdded: false };
  const { error: accessErr } = await db.from("launcher_user_access").insert({ profile_id: profileId, app_id: appId });
  if (accessErr && accessErr.code !== "23505") return { ok: false, error: "Editing granted, but couldn't open the handbook tile for them." };
  return { ok: true, accessAdded: true };
}
