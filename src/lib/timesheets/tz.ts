// Time-zone helpers. The timesheet system standardises on Eastern Time
// (America/New_York, which auto-handles EST vs EDT). Vercel functions run
// in UTC by default, so anything that calls setHours() / getDay() on a
// Date is interpreting the number in UTC — this module lets us anchor
// those operations to ET without pulling in a tz library.

export const DEFAULT_ZONE = "America/New_York";

// Returns the UTC Date corresponding to `HH:MM` on the ET-local calendar
// day that `baseDate` falls into.
//
// Example: scheduledTimeInZone(now, "18:00") on 2026-09-15 during EDT →
// a Date whose ISO is 2026-09-15T22:00:00Z (18:00 EDT).
export function scheduledTimeInZone(
  baseDate: Date,
  timeStr: string,
  zone: string = DEFAULT_ZONE,
): Date {
  const [hhStr, mmStr] = timeStr.split(":");
  const hh = Number(hhStr);
  const mm = Number(mmStr);
  const dateInZone = baseDate.toLocaleDateString("en-CA", { timeZone: zone });
  // Interpret the naive local time as if it were UTC. Then compute the zone
  // offset at that approximate moment and subtract it.
  const naiveUtc = new Date(
    `${dateInZone}T${pad(hh)}:${pad(mm)}:00Z`,
  );
  // "sv-SE" locale formats a Date as "YYYY-MM-DD HH:mm:ss" — a stable ISO-ish
  // string we can re-parse as UTC to measure the zone offset.
  const inZoneStr = naiveUtc.toLocaleString("sv-SE", { timeZone: zone });
  const asIfLocalWereUtc = new Date(inZoneStr.replace(" ", "T") + "Z");
  const offsetMs = naiveUtc.getTime() - asIfLocalWereUtc.getTime();
  return new Date(naiveUtc.getTime() + offsetMs);
}

// 0 = Sunday .. 6 = Saturday, matching JS Date.getDay(), but computed
// against the zone-local calendar (so 11:30pm ET Saturday isn't Sunday).
export function weekdayInZone(date: Date, zone: string = DEFAULT_ZONE): number {
  const iso = date.toLocaleDateString("en-CA", { timeZone: zone });
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// "YYYY-MM-DD" as the zone-local calendar date.
export function localDateInZone(date: Date, zone: string = DEFAULT_ZONE): string {
  return date.toLocaleDateString("en-CA", { timeZone: zone });
}

// Midnight (00:00) of the zone-local day containing `date`, as a UTC Date.
export function startOfDayInZone(
  date: Date,
  zone: string = DEFAULT_ZONE,
): Date {
  return scheduledTimeInZone(date, "00:00", zone);
}

// Midnight of the zone-local Sunday that begins the week containing `date`.
export function startOfWeekSundayInZone(
  date: Date,
  zone: string = DEFAULT_ZONE,
): Date {
  const wd = weekdayInZone(date, zone);
  const iso = localDateInZone(date, zone);
  const [y, m, d] = iso.split("-").map(Number);
  // Move d back by `wd` days on the zone calendar.
  const shifted = new Date(Date.UTC(y, m - 1, d - wd));
  const shiftedIso = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  return scheduledTimeInZone(new Date(shiftedIso + "T12:00:00Z"), "00:00", zone);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
