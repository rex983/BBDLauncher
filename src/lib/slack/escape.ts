// Slack parses <…> in message text as mentions and links (<!channel>,
// <@U123>, <https://evil|looks-safe>), so anything a user typed — names,
// titles, reasons — has to be escaped before it goes into mrkdwn.
export function slackEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Escapes every string field of a flat payload, leaving other values alone.
export function slackEscapeFields<T extends object>(p: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) out[k] = typeof v === "string" ? slackEscape(v) : v;
  return out as T;
}
