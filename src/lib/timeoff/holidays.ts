// Company holidays (migration 070): days the whole company is off. They
// never count as a day off — every requestDays / countBusinessDays caller
// passes the dates from here. Pure apart from the Supabase client it is
// handed, so client components can import the types and helpers.
//
// A holiday is stored once, as a rule (migration 071): either one time, or
// every year from its first date on. loadHolidays turns the rules into the
// actual dates, so everything that counts days just sees dates.

import type { SupabaseClient } from "@supabase/supabase-js";

// How a holiday comes back each year. All of them are read off the rule's
// own date, so nothing else is stored:
//   none          one time, that date only
//   date          the same month and day (Dec 25)
//   weekday       the same nth weekday of the month (4th Thursday of November)
//   last_weekday  the last such weekday of the month (last Monday of May)
//   easter        the same number of days from Easter Sunday
export const HOLIDAY_RECURRENCES = ["none", "date", "weekday", "last_weekday", "easter"] as const;
export type HolidayRecurrence = (typeof HOLIDAY_RECURRENCES)[number];

// A holiday as stored. `date` is its first (or only) date.
export interface HolidayRule {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  recurrence: HolidayRecurrence;
}

// One actual day off. A yearly rule yields one of these per year.
export interface Holiday {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
}

export const HOLIDAY_COLUMNS = "id, date:holiday_date, name, recurrence";

// Yearly holidays are worked out this many years past the current one —
// far beyond any time-off request or calendar anyone opens.
const YEARS_AHEAD = 10;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];
const DAY_MS = 86_400_000;

// Dates here are plain calendar days, so all the math is done in UTC.
function parse(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}
function daysInMonth(year: number, month: number): number {
  return utc(year, month + 1, 0).getUTCDate();
}

// Easter Sunday (Gregorian; the anonymous / Meeus algorithm).
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

// Days from Easter Sunday of its own year (Good Friday is -2).
function easterOffset(d: Date): number {
  return Math.round((d.getTime() - easterSunday(d.getUTCFullYear()).getTime()) / DAY_MS);
}

// Days around Easter that have a name. Other dates aren't offered as
// "every year at Easter".
const EASTER_DAYS: Record<number, string> = {
  [-2]: "Good Friday",
  0: "Easter Sunday",
  1: "Easter Monday",
};

// The date a rule lands on in a given year, or null when it doesn't (a one
// time holiday in another year, any year before the rule starts, Feb 29 in
// a common year, a 5th weekday the month doesn't have).
export function occurrenceIn(rule: Pick<HolidayRule, "date" | "recurrence">, year: number): string | null {
  const first = parse(rule.date);
  const firstYear = first.getUTCFullYear();
  if (year === firstYear) return rule.date;
  if (rule.recurrence === "none" || year < firstYear) return null;
  const month = first.getUTCMonth();
  const day = first.getUTCDate();
  const weekday = first.getUTCDay();

  if (rule.recurrence === "date") {
    return day <= daysInMonth(year, month) ? iso(utc(year, month, day)) : null;
  }
  if (rule.recurrence === "weekday") {
    const nth = Math.ceil(day / 7);
    const firstOfKind = 1 + ((weekday - utc(year, month, 1).getUTCDay() + 7) % 7);
    const target = firstOfKind + (nth - 1) * 7;
    return target <= daysInMonth(year, month) ? iso(utc(year, month, target)) : null;
  }
  if (rule.recurrence === "last_weekday") {
    const last = daysInMonth(year, month);
    const back = (utc(year, month, last).getUTCDay() - weekday + 7) % 7;
    return iso(utc(year, month, last - back));
  }
  // easter
  return iso(new Date(easterSunday(year).getTime() + easterOffset(first) * DAY_MS));
}

// Every actual holiday date the rules produce, through `throughYear`.
export function expandHolidays(rules: readonly HolidayRule[], throughYear: number): Holiday[] {
  const out: Holiday[] = [];
  for (const r of rules) {
    const firstYear = parse(r.date).getUTCFullYear();
    const lastYear = r.recurrence === "none" ? firstYear : Math.max(firstYear, throughYear);
    for (let y = firstYear; y <= lastYear; y++) {
      const date = occurrenceIn(r, y);
      if (date) out.push({ id: r.id, date, name: r.name });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// The rule's next date on or after `fromISO`, or null when it is over (a
// one time holiday in the past).
export function nextOccurrence(rule: Pick<HolidayRule, "date" | "recurrence">, fromISO: string): string | null {
  const startYear = Math.max(parse(rule.date).getUTCFullYear(), parse(fromISO).getUTCFullYear());
  // A few years of slack covers Feb 29 and 5th-weekday rules that skip years.
  for (let y = startYear; y <= startYear + 8; y++) {
    const date = occurrenceIn(rule, y);
    if (date && date >= fromISO) return date;
  }
  return null;
}

// "Every year on …" in words, read off the rule's date.
export function recurrenceLabel(rule: Pick<HolidayRule, "date" | "recurrence">): string {
  if (rule.recurrence === "none") return "One time";
  const d = parse(rule.date);
  if (Number.isNaN(d.getTime())) return "";
  const month = MONTHS[d.getUTCMonth()];
  const weekday = WEEKDAYS[d.getUTCDay()];
  switch (rule.recurrence) {
    case "date":
      return `Every year on ${month} ${d.getUTCDate()}`;
    case "weekday":
      return `Every year on the ${ORDINALS[Math.ceil(d.getUTCDate() / 7) - 1]} ${weekday} of ${month}`;
    case "last_weekday":
      return `Every year on the last ${weekday} of ${month}`;
    case "easter":
      return `Every year on ${EASTER_DAYS[easterOffset(d)] ?? "the same day around Easter"}`;
  }
}

// The ways a holiday on this date can repeat: always one time and the same
// date; the nth weekday when the month always has one; the last weekday
// when it is the last one; Easter when the date is one of the Easter days.
export function recurrenceChoices(dateISO: string): HolidayRecurrence[] {
  const d = parse(dateISO);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || Number.isNaN(d.getTime()) || iso(d) !== dateISO) {
    return ["none"];
  }
  const day = d.getUTCDate();
  const out: HolidayRecurrence[] = ["none", "date"];
  if (day <= 28) out.push("weekday");
  if (day + 7 > daysInMonth(d.getUTCFullYear(), d.getUTCMonth())) out.push("last_weekday");
  if (easterOffset(d) in EASTER_DAYS) out.push("easter");
  return out;
}

async function readRules(supabase: SupabaseClient): Promise<HolidayRule[]> {
  const { data, error } = await supabase
    .from("company_holidays")
    .select(HOLIDAY_COLUMNS)
    .order("holiday_date", { ascending: true });
  if (!error) return (data || []) as unknown as HolidayRule[];

  // Before migration 071 there is no recurrence column: every row is a one
  // time holiday, so read them that way rather than dropping holidays.
  const old = await supabase
    .from("company_holidays")
    .select("id, date:holiday_date, name")
    .order("holiday_date", { ascending: true });
  if (old.error) {
    // Includes the table not existing before migration 070 is applied.
    console.error("company_holidays read failed:", error.message);
    return [];
  }
  return ((old.data || []) as unknown as Omit<HolidayRule, "recurrence">[]).map((h) => ({
    ...h,
    recurrence: "none",
  }));
}

// Every actual holiday date, oldest first: one time holidays, and each
// yearly holiday from its first year through ten years from now. A read
// failure yields no holidays, so day counts fall back to schedule-only
// instead of breaking.
export async function loadHolidays(supabase: SupabaseClient): Promise<Holiday[]> {
  const rules = await readRules(supabase);
  return expandHolidays(rules, new Date().getUTCFullYear() + YEARS_AHEAD);
}

export function holidayDates(holidays: readonly Pick<Holiday, "date">[]): ReadonlySet<string> {
  return new Set(holidays.map((h) => h.date));
}
