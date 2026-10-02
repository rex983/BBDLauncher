// PostgREST silently caps rows (Supabase default 1000), so reads that can
// exceed one page walk `.range()` windows until a short page comes back.
// `page(from, to)` builds the query for one inclusive window.
const PAGE_SIZE = 1000;
const MAX_ROWS = 200_000;

export async function fetchAllPages<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: string | null }> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: [], error: error.message };
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return { data: out, error: null };
}
