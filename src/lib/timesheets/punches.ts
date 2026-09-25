import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimePunch } from "@/lib/timesheets/state";

const PAGE_SIZE = 1000;
const PUNCH_COLUMNS = "id, profile_id, event_type, occurred_at, source, note";

// PostgREST silently caps rows (Supabase default 1000), so a multi-week
// read across a whole office would quietly drop punches — and undercount
// hours + overtime — without paging. Ordered by (occurred_at, id) so page
// boundaries are stable even when two punches share a timestamp.
export async function fetchPunchesPaged(
  supabase: SupabaseClient,
  profileIds: string[],
  fromISO: string,
  toISO?: string,
): Promise<{ data: TimePunch[]; error: string | null }> {
  const out: TimePunch[] = [];
  if (profileIds.length === 0) return { data: out, error: null };
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = supabase
      .from("time_punches")
      .select(PUNCH_COLUMNS)
      .in("profile_id", profileIds)
      .gte("occurred_at", fromISO);
    if (toISO) q = q.lte("occurred_at", toISO);
    const { data, error } = await q
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { data: out, error: error.message };
    out.push(...((data || []) as TimePunch[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { data: out, error: null };
}
