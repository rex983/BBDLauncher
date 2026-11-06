// Rep check-ins: when they come (hours after the first clock-in of the day)
// and what they say. Client-safe; shared by the cron (/api/cron/rep-checkins)
// and the popup (CheckInPrompt). Who gets them: src/lib/rep-checkins.ts.

export const CHECKPOINTS = [3, 6];

export const checkinTitle = (hours: number) => `${hours} hours in: how's today going?`;
