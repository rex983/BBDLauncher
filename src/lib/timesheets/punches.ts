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
  return pageAll((from) => {
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
  });
}

// Same as fetchPunchesPaged, but for everyone in a (office, department,
// active) scope — the scope is applied in SQL (get_scoped_time_punches,
// migration 047) instead of sending every profile id in the URL.
export async function fetchScopedPunchesPaged(
  supabase: SupabaseClient,
  scope: { office: string | null; department: string | null; includeInactive: boolean },
  fromISO: string,
): Promise<{ data: TimePunch[]; error: string | null }> {
  return pageAll((from) =>
    supabase
      .rpc("get_scoped_time_punches", {
        p_since: fromISO,
        p_office: scope.office,
        p_department: scope.department,
        p_include_inactive: scope.includeInactive,
      })
      .select(PUNCH_COLUMNS)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1),
  );
}

async function pageAll(
  // `data: unknown` because untyped .rpc() results are typed as row-or-array.
  page: (from: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ data: TimePunch[]; error: string | null }> {
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
