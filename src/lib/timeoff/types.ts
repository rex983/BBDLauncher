// Time-off type + subcategory taxonomy shared between the request form
// and the manager views. Kept in one place so the zod validator, the
// dropdowns, and the display formatting all agree.
//
// Subcategories mirror the retired Google Form. Values are stored verbatim
// so historical form entries and new app entries render the same way.

export type TimeOffType = "vacation" | "sick" | "personal" | "parental" | "other";
export type TimeOffStatus = "pending" | "approved" | "denied" | "cancelled";

// A single uploaded document attached to a request. `path` is the storage
// object key inside the private `time-off-attachments` bucket — never a
// full URL. Download links are minted on demand by the /api/timeoff/
// attachments/[...path] route.
export interface TimeOffAttachment {
  path: string;
  filename: string;
  size: number;
  mime: string;
}

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
// fills the notes field. Values mirror the retired Google Form verbatim
// (including plurals) so historical entries and new app entries line up.
export const TIME_OFF_SUBCATEGORIES: Record<TimeOffType, string[]> = {
  personal: [
    "Illness or injury",
    "Mental health",
    "Appointments",
    "Family emergencies",
    "Personal development",
    "Other",
  ],
  vacation: [
    "Planned vacations",
    "Sabbaticals",
    "Staycations",
  ],
  parental: [
    "Maternity leave",
    "Paternity leave",
    "Family leave",
  ],
  sick: [
    "Short-term illness",
    "Chronic illness",
    "Disability leave",
  ],
  other: [],
};

// Full descriptive line from the original form. Used as the tooltip that
// pops up on hover in the dropdown so employees see familiar guidance
// without cluttering the option label itself.
export const TIME_OFF_SUBCATEGORY_HINTS: Record<string, string> = {
  // Personal
  "Illness or injury": "Taking time off for their own illness or injury, or to care for a sick family member.",
  "Mental health": "Taking time for mental health reasons, such as stress, anxiety, or depression.",
  "Appointments": "Attending medical, dental, or other important appointments.",
  "Family emergencies": "Dealing with unexpected family situations like a death, illness, or birth.",
  "Personal development": "Taking time for personal growth, such as attending a wedding, a funeral, or a religious holiday.",
  // Vacation
  "Planned vacations": "Taking time off for pre-planned leisure activities and travel.",
  "Sabbaticals": "Taking an extended period of leave for personal or professional development.",
  "Staycations": "Taking time off to relax and recharge at home or in the local area.",
  // Parental
  "Maternity leave": "Taking time off after childbirth or adoption to care for a newborn or newly adopted child.",
  "Paternity leave": "Taking time off to bond with a newborn or newly adopted child.",
  "Family leave": "Taking time off to care for a child or other family member with a serious illness or injury.",
  // Sick
  "Short-term illness": "Taking time off for short-term illnesses like the flu or a cold.",
  "Chronic illness": "Taking time off to manage a chronic illness.",
  "Disability leave": "Taking time off for a long-term disability.",
};

// Standardized reason options for the manager "Mark day off" dialog.
// Kept as a flat list — managers usually reach for the same handful of
// phrases (called out sick, family emergency, no-show) and shouldn't
// have to freehand-type them. "Other" flips the form to a text input.
export const TIME_OFF_MANAGER_REASONS = [
  "Sick day",
  "Family emergency",
  "Personal emergency",
  "Medical appointment",
  "Bereavement",
  "Jury duty",
  "Called out",
  "No-show",
  "Vacation",
  "Other",
] as const;

export type TimeOffManagerReason = (typeof TIME_OFF_MANAGER_REASONS)[number];

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
