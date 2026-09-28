import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimePunch } from "@/lib/timesheets/state";

const PAGE_SIZE = 1000;
const PUNCH_COLUMNS = "id, profile_id, event_type, occurred_at, source, note";

// Parallel page requests per batch — keeps a year-long office read from
// firing dozens of concurrent queries at the shared Supabase project.
const PAGE_CONCURRENCY = 4;

// PostgREST silently caps rows (Supabase default 1000), so a multi-week
// read across a whole office would quietly drop punches — and undercount
// hours + overtime — without paging. Ordered by (occurred_at, id) so page
// boundaries are stable even when two punches share a timestamp. Most
// reads fit in one page, so pages are fetched in small parallel batches
// until one comes back short — no upfront COUNT.
export async function fetchPunchesPaged(
  supabase: SupabaseClient,
  profileIds: string[],
  fromISO: string,
  toISO?: string,
): Promise<{ data: TimePunch[]; error: string | null }> {
  if (profileIds.length === 0) return { data: [], error: null };
  const page = (from: number) => {
    let q = supabase
      .from("time_punches")
      .select(PUNCH_COLUMNS)
      .in("profile_id", profileIds)
      .gte("occurred_at", fromISO);
    if (toISO) q = q.lte("occurred_at", toISO);
    return q
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
  };

  const out: TimePunch[] = [];
  // First page alone (the common single-page case), then batches.
  for (let next = 0, batch = 1; ; batch = PAGE_CONCURRENCY) {
    const offsets = Array.from({ length: batch }, (_, i) => next + i * PAGE_SIZE);
    next += batch * PAGE_SIZE;
    for (const res of await Promise.all(offsets.map(page))) {
      if (res.error) return { data: [], error: res.error.message };
      const rows = (res.data || []) as TimePunch[];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) return { data: out, error: null };
    }
  }
}
