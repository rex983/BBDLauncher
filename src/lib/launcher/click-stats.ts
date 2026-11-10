import { createAdminClient } from "@/lib/supabase/admin";
import type { ClickStats } from "@/components/features/launcher/sort";

const EMPTY: ClickStats = { apps: {}, links: {} };

// How often this person has opened each app and link (migration 064), for
// the dashboard's "Sort by". Never throws: with no numbers every item counts
// as 0 clicks and the click sorts fall back to A–Z.
export async function getClickStats(userId: string): Promise<ClickStats> {
  const { data, error } = await createAdminClient().rpc("launcher_my_click_counts", {
    p_user_id: userId,
  });
  if (error) {
    console.error("launcher_my_click_counts failed:", error.message);
    return EMPTY;
  }
  const stats: ClickStats = { apps: {}, links: {} };
  for (const r of (data ?? []) as { kind: string; id: string; clicks: number; last_at: string }[]) {
    const bucket = r.kind === "app" ? stats.apps : stats.links;
    bucket[r.id] = { clicks: Number(r.clicks), lastAt: r.last_at };
  }
  return stats;
}
