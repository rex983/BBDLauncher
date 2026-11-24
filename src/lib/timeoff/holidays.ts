// Company holidays (migration 070): days the whole company is off. They
// never count as a day off — every requestDays / countBusinessDays caller
// passes the dates from here. Pure apart from the Supabase client it is
// handed, so client components can import the types and helpers.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface Holiday {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
}

export const HOLIDAY_COLUMNS = "id, date:holiday_date, name";

// Every holiday, oldest first. The table is a handful of rows a year, so
// callers take the lot rather than a date window. A read failure (including
// the table not existing before migration 070 is applied) yields no
// holidays, so day counts fall back to schedule-only instead of breaking.
export async function loadHolidays(supabase: SupabaseClient): Promise<Holiday[]> {
  const { data, error } = await supabase
    .from("company_holidays")
    .select(HOLIDAY_COLUMNS)
    .order("holiday_date", { ascending: true });
  if (error) {
    console.error("company_holidays read failed:", error.message);
    return [];
  }
  return (data || []) as unknown as Holiday[];
}

export function holidayDates(holidays: readonly Pick<Holiday, "date">[]): ReadonlySet<string> {
  return new Set(holidays.map((h) => h.date));
}
