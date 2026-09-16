// Time-off type + subcategory taxonomy shared between the request form
// and the manager views. Kept in one place so the zod validator, the
// dropdowns, and the display formatting all agree.
//
// Subcategories mirror the retired Google Form. Values are stored verbatim
// so historical form entries and new app entries render the same way.

export type TimeOffType = "vacation" | "sick" | "personal" | "parental" | "other";
export type TimeOffStatus = "pending" | "approved" | "denied" | "cancelled";

export const TIME_OFF_TYPES: { value: TimeOffType; label: string }[] = [
  { value: "vacation", label: "Vacation & Leisure" },
  { value: "sick", label: "Sick" },
  { value: "personal", label: "Personal" },
  { value: "parental", label: "Parental" },
  { value: "other", label: "Other" },
];

export const TIME_OFF_TYPE_LABEL: Record<TimeOffType, string> = Object.fromEntries(
  TIME_OFF_TYPES.map((t) => [t.value, t.label]),
) as Record<TimeOffType, string>;

// Subcategory options per type. `other` has no subcategory — the user just
// fills the notes field. All values are the canonical Google-Form phrasing.
export const TIME_OFF_SUBCATEGORIES: Record<TimeOffType, string[]> = {
  vacation: [
    "Planned vacation",
    "Staycation",
    "Sabbatical",
  ],
  sick: [
    "Short-term illness",
    "Chronic illness",
  ],
  personal: [
    "Personal development",
    "Family emergency",
    "Mental health",
    "Appointment",
    "Illness or injury",
    "Other",
  ],
  parental: [
    "Family leave",
    "Maternity leave",
    "Paternity leave",
    "Adoption leave",
  ],
  other: [],
};

// Longer descriptions kept for hover / help text, matching the phrasing on
// the original Google Form so employees see familiar language.
export const TIME_OFF_SUBCATEGORY_HINTS: Record<string, string> = {
  "Planned vacation": "Pre-planned leisure activities and travel.",
  "Staycation": "Relax and recharge at home or locally.",
  "Sabbatical": "Extended period of leave for personal or professional development.",
  "Short-term illness": "Short-term illness like the flu or a cold.",
  "Chronic illness": "Managing a chronic illness.",
  "Personal development": "Personal growth — a wedding, funeral, or religious holiday.",
  "Family emergency": "Unexpected family situation like a death, illness, or birth.",
  "Mental health": "Stress, anxiety, or depression.",
  "Appointment": "Medical, dental, or other important appointments.",
  "Illness or injury": "Your own illness or injury, or caring for a sick family member.",
  "Family leave": "Caring for a child or other family member with a serious illness or injury.",
  "Maternity leave": "Time off surrounding the birth of a child.",
  "Paternity leave": "Time off surrounding the birth of a child.",
  "Adoption leave": "Time off surrounding an adoption.",
};

// Business-day counter used by the manager summary. Excludes Sat/Sun so a
// Friday–Monday request counts as 2 days, not 4. For partial-day requests
// we credit `hours / 8` days rounded to one decimal.
export function countBusinessDays(startISO: string, endISO: string): number {
  const start = new Date(startISO + "T00:00:00");
  const end = new Date(endISO + "T00:00:00");
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export function requestDays(r: {
  start_date: string;
  end_date: string;
  full_day: boolean;
  hours: number | null;
}): number {
  if (!r.full_day && r.hours) {
    return Math.round((r.hours / 8) * 10) / 10;
  }
  return countBusinessDays(r.start_date, r.end_date);
}
