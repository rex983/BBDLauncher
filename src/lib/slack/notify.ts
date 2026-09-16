// Slack Incoming Webhook helpers. Posts JSON to a webhook URL configured
// per notification type via env var — no OAuth, no bot token, one channel
// per URL. Fire-and-forget: failures are logged, never thrown, so a
// broken webhook can't break the primary user flow (submitting a request).

import type { TimeOffType } from "@/lib/timeoff/types";
import { TIME_OFF_TYPE_LABEL } from "@/lib/timeoff/types";

const LAUNCHER_URL = process.env.LAUNCHER_URL || "https://bbd-launcher.vercel.app";

// Colored bars along the left edge of the Slack attachment — one per
// type so glanceable at a distance.
const TYPE_COLOR: Record<TimeOffType, string> = {
  vacation: "#0ea5e9",
  sick: "#f43f5e",
  personal: "#f59e0b",
  parental: "#8b5cf6",
  other: "#64748b",
};

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export interface TimeOffSubmittedPayload {
  employeeName: string;
  employeeEmail: string;
  type: TimeOffType;
  subcategory: string | null;
  startDate: string;
  endDate: string;
  fullDay: boolean;
  hours: number | null;
  reason: string | null;
  attachmentCount: number;
}

export async function notifyTimeOffSubmitted(p: TimeOffSubmittedPayload): Promise<void> {
  const url = process.env.SLACK_TIMEOFF_WEBHOOK_URL;
  if (!url) return; // No-op when the webhook isn't configured.

  const dateLine = p.startDate === p.endDate
    ? fmtDate(p.startDate)
    : `${fmtDate(p.startDate)} → ${fmtDate(p.endDate)}`;

  const length = p.fullDay ? "Full day(s)" : `${p.hours}h`;
  const typeLine = p.subcategory
    ? `${TIME_OFF_TYPE_LABEL[p.type]} · ${p.subcategory}`
    : TIME_OFF_TYPE_LABEL[p.type];

  // Slack "attachments" are the legacy formatting layer but still the
  // easiest way to get a colored side-bar per type. Blocks would need a
  // context+section combo without the color.
  const body = {
    text: `New time-off request from ${p.employeeName}`,
    attachments: [
      {
        color: TYPE_COLOR[p.type],
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                `*New time-off request*`,
                `*${p.employeeName}* \`${p.employeeEmail}\``,
              ].join("\n"),
            },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Type*\n${typeLine}` },
              { type: "mrkdwn", text: `*Length*\n${length}` },
              { type: "mrkdwn", text: `*Dates*\n${dateLine}` },
              ...(p.attachmentCount > 0
                ? [{ type: "mrkdwn", text: `*Attachments*\n${p.attachmentCount} file${p.attachmentCount === 1 ? "" : "s"}` }]
                : []),
            ],
          },
          ...(p.reason
            ? [{
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*Notes*\n>${p.reason.replace(/\n/g, "\n>")}`,
                },
              }]
            : []),
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Review in launcher" },
                url: `${LAUNCHER_URL}/management/timeoff`,
                style: "primary",
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[slack] time-off webhook failed:", res.status, text);
    }
  } catch (err) {
    console.error("[slack] time-off webhook error:", err);
  }
}
