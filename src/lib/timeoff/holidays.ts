// Company holidays (migration 070): days the whole company is off. They
// never count as a day off — every requestDays / countBusinessDays caller
// passes the dates from here. Pure apart from the Supabase client it is
// handed, so client components can import the types and helpers.
//
// A holiday can also belong to one person (migration 071, profile_id set):
// it is a holiday for them and a normal day for everyone else.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface Holiday {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  profile_id: string | null; // null = everyone
}

export const HOLIDAY_COLUMNS = "id, date:holiday_date, name, profile_id";

// Every holiday, oldest first. The table is a handful of rows a year, so
// callers take the lot rather than a date window. A read failure (including
// the table not existing before migration 070 is applied) yields no
// holidays, so day counts fall back to schedule-only instead of breaking.
export async function loadHolidays(supabase: SupabaseClient): Promise<Holiday[]> {
  const { data, error } = await supabase
    .from("company_holidays")
    .select(HOLIDAY_COLUMNS)
    .order("holiday_date", { ascending: true });
  if (!error) return (data || []) as unknown as Holiday[];

  // Before migration 071 there is no profile_id column: every row is
  // company-wide, so read them that way rather than dropping holidays.
  const old = await supabase
    .from("company_holidays")
    .select("id, date:holiday_date, name")
    .order("holiday_date", { ascending: true });
  if (old.error) {
    console.error("company_holidays read failed:", error.message);
    return [];
  }
  return ((old.data || []) as unknown as Omit<Holiday, "profile_id">[]).map((h) => ({
    ...h,
    profile_id: null,
  }));
}

// The holidays that apply to one person: the company-wide ones plus their
// own. With no person, only the company-wide ones.
export function holidaysFor<H extends Pick<Holiday, "profile_id">>(
  holidays: readonly H[],
  profileId?: string | null,
): H[] {
  return holidays.filter((h) => !h.profile_id || h.profile_id === profileId);
}

// Dates that are a holiday for this person (see holidaysFor).
export function holidayDates(
  holidays: readonly Pick<Holiday, "date" | "profile_id">[],
  profileId?: string | null,
): ReadonlySet<string> {
  return new Set(holidaysFor(holidays, profileId).map((h) => h.date));
}
