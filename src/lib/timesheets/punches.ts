import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimePunch } from "@/lib/timesheets/state";

const PAGE_SIZE = 1000;
const PUNCH_COLUMNS = "id, profile_id, event_type, occurred_at, source, note";

// PostgREST silently caps rows (Supabase default 1000), so a multi-week
// read across a whole office would quietly drop punches — and undercount
// hours + overtime — without paging. Ordered by (occurred_at, id) so page
// boundaries are stable even when two punches share a timestamp. The first
// page carries an exact count; the rest are fetched in parallel.
export async function fetchPunchesPaged(
  supabase: SupabaseClient,
  profileIds: string[],
  fromISO: string,
  toISO?: string,
): Promise<{ data: TimePunch[]; error: string | null }> {
  if (profileIds.length === 0) return { data: [], error: null };
  const page = (from: number, withCount = false) => {
    let q = supabase
      .from("time_punches")
      .select(PUNCH_COLUMNS, withCount ? { count: "exact" } : undefined)
      .in("profile_id", profileIds)
      .gte("occurred_at", fromISO);
    if (toISO) q = q.lte("occurred_at", toISO);
    return q
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
  };

  const first = await page(0, true);
  if (first.error) return { data: [], error: first.error.message };
  const out = (first.data || []) as TimePunch[];
  const total = first.count ?? out.length;

  const rest = [];
  for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE) rest.push(page(from));
  for (const res of await Promise.all(rest)) {
    if (res.error) return { data: [], error: res.error.message };
    out.push(...((res.data || []) as TimePunch[]));
  }
  return { data: out, error: null };
}
