import type { createAdminClient } from "@/lib/supabase/admin";
import { permRoleResolver } from "@/lib/auth/perm-role";

// Who gets the 3- and 6-hour check-ins (cron /api/cron/rep-checkins), and
// whom admins can look at in the check-in dialog (/api/checkin-reps).
//
// Sales reps: people Rep Insights counts (bbd-rep-insights
// src/lib/counted-roles.ts: active, linked to a rep in rep_reps, launcher
// role in rep_settings.counted_roles) whose highest level is sales rep. When
// someone fits more than one, the higher wins (admin > manager > team lead >
// sales rep): a role acting as anything but sales_rep, or leading a team in
// the launcher, means no check-ins.

export async function salesRepProfiles(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{ id: string; name: string }[]> {
  const [reps, setting, leaders, permRole] = await Promise.all([
    supabase.from("rep_reps").select("profile_id").eq("active", true).not("profile_id", "is", null),
    supabase.from("rep_settings").select("value").eq("key", "counted_roles").maybeSingle(),
    supabase.from("launcher_teams").select("leader_id").not("leader_id", "is", null),
    permRoleResolver(),
  ]);
  if (reps.error) throw new Error(`rep_reps: ${reps.error.message}`);
  if (leaders.error) throw new Error(`launcher_teams: ${leaders.error.message}`);
  const leading = new Set((leaders.data ?? []).map((t) => t.leader_id as string));
  const value = setting.data?.value;
  const roles = Array.isArray(value) ? value.filter((r): r is string => typeof r === "string") : ["sales_rep"];
  if (roles.includes("sales_rep") && !roles.includes("team_lead")) roles.push("team_lead");
  const ids = [...new Set((reps.data ?? []).map((r) => r.profile_id as string))];
  if (!ids.length) return [];
  const { data, error } = await supabase.from("profiles").select("id, role, is_active, full_name, email").in("id", ids);
  if (error) throw new Error(`profiles: ${error.message}`);
  return (data ?? [])
    .filter(
      (p) =>
        p.is_active !== false &&
        roles.includes(p.role as string) &&
        permRole(p.role as string) === "sales_rep" &&
        !leading.has(p.id as string),
    )
    .map((p) => ({ id: p.id as string, name: ((p.full_name as string | null) || (p.email as string)).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
