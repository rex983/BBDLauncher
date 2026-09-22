// Slack Incoming Webhook helpers. Posts JSON to a webhook URL configured
// per notification type via env var — no OAuth, no bot token, one channel
// per URL. Fire-and-forget: failures are logged, never thrown, so a
// broken webhook can't break the primary user flow (submitting a request).

import type { TimeOffType } from "@/lib/timeoff/types";
import { TIME_OFF_TYPE_LABEL } from "@/lib/timeoff/types";
import type { IncidentSeverity, IncidentCategory } from "@/lib/incidents/types";
import { INCIDENT_CATEGORY_LABEL, INCIDENT_SEVERITY_LABEL } from "@/lib/incidents/types";
import type {
  MemoAcknowledgementMode,
  MemoCategory,
  MemoPriority,
} from "@/lib/memos/types";
import {
  MEMO_ACK_MODE_LABEL,
  MEMO_CATEGORY_LABEL,
  MEMO_PRIORITY_LABEL,
} from "@/lib/memos/types";

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

// =====================================================================
// Incident reports — separate webhook (SLACK_INCIDENT_WEBHOOK_URL) so HR can
// route them to a private channel instead of the general time-off channel.
// Severity drives the side-bar color so a critical report stands out from
// a low-severity coaching note at a glance.
// =====================================================================

const INCIDENT_SEVERITY_COLOR: Record<IncidentSeverity, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#ea580c",
  critical: "#dc2626",
};

export interface IncidentSubmittedPayload {
  incidentId: string;
  employeeName: string;
  employeeEmail: string;
  reporterName: string;
  title: string;
  severity: IncidentSeverity;
  category: IncidentCategory;
  attachmentCount: number;
}

export async function notifyIncidentSubmitted(p: IncidentSubmittedPayload): Promise<void> {
  const url = process.env.SLACK_INCIDENT_WEBHOOK_URL;
  if (!url) return;

  const body = {
    text: `New incident report filed for ${p.employeeName}`,
    attachments: [
      {
        color: INCIDENT_SEVERITY_COLOR[p.severity],
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                `*New incident report*`,
                `*${p.title}*`,
                `Filed by ${p.reporterName}`,
              ].join("\n"),
            },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Employee*\n${p.employeeName}\n\`${p.employeeEmail}\`` },
              { type: "mrkdwn", text: `*Severity*\n${INCIDENT_SEVERITY_LABEL[p.severity]}` },
              { type: "mrkdwn", text: `*Category*\n${INCIDENT_CATEGORY_LABEL[p.category]}` },
              ...(p.attachmentCount > 0
                ? [{ type: "mrkdwn", text: `*Attachments*\n${p.attachmentCount} file${p.attachmentCount === 1 ? "" : "s"}` }]
                : []),
            ],
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Open in launcher" },
                url: `${LAUNCHER_URL}/management/incidents/${p.incidentId}`,
                style: "primary",
              },
            ],
          },
        ],
      },
    ],
  };

  await postSlack(url, body, "incident-submitted");
}

export interface IncidentCompletedPayload {
  incidentId: string;
  employeeName: string;
  title: string;
  severity: IncidentSeverity;
}

export async function notifyIncidentCompleted(p: IncidentCompletedPayload): Promise<void> {
  const url = process.env.SLACK_INCIDENT_WEBHOOK_URL;
  if (!url) return;

  const body = {
    text: `Incident report signed by ${p.employeeName}`,
    attachments: [
      {
        color: INCIDENT_SEVERITY_COLOR[p.severity],
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                `*Incident report signed*`,
                `*${p.title}*`,
                `${p.employeeName} has acknowledged this report.`,
              ].join("\n"),
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "View signed report" },
                url: `${LAUNCHER_URL}/management/incidents/${p.incidentId}`,
              },
            ],
          },
        ],
      },
    ],
  };

  await postSlack(url, body, "incident-completed");
}

// =====================================================================
// Office memos — separate webhook (SLACK_MEMO_WEBHOOK_URL) so
// company-wide memos don't clutter the HR incident channel. Priority
// drives the side-bar color at a glance.
// =====================================================================

const MEMO_PRIORITY_COLOR: Record<MemoPriority, string> = {
  informational: "#0ea5e9",
  important: "#f59e0b",
  mandatory: "#dc2626",
};

export interface MemoPublishedPayload {
  memoId: string;
  numberLabel: string;
  title: string;
  category: MemoCategory;
  priority: MemoPriority;
  audienceLabel: string;
  recipientCount: number;
  authorName: string;
  ackMode: MemoAcknowledgementMode;
}

export async function notifyMemoPublished(p: MemoPublishedPayload): Promise<void> {
  const url = process.env.SLACK_MEMO_WEBHOOK_URL;
  if (!url) return;

  const titleLine = p.numberLabel ? `${p.numberLabel} · ${p.title}` : p.title;

  const body = {
    text: `New memo from ${p.authorName}: ${p.title}`,
    attachments: [
      {
        color: MEMO_PRIORITY_COLOR[p.priority],
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: [
                `*New memo published*`,
                `*${titleLine}*`,
                `Author: ${p.authorName}`,
              ].join("\n"),
            },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Category*\n${MEMO_CATEGORY_LABEL[p.category]}` },
              { type: "mrkdwn", text: `*Priority*\n${MEMO_PRIORITY_LABEL[p.priority]}` },
              { type: "mrkdwn", text: `*Audience*\n${p.audienceLabel}` },
              { type: "mrkdwn", text: `*Recipients*\n${p.recipientCount}` },
              { type: "mrkdwn", text: `*Acknowledgement*\n${MEMO_ACK_MODE_LABEL[p.ackMode]}` },
            ],
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Open in launcher" },
                url: `${LAUNCHER_URL}/management/memos`,
                style: "primary",
              },
            ],
          },
        ],
      },
    ],
  };

  await postSlack(url, body, "memo-published");
}

async function postSlack(url: string, body: unknown, label: string): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[slack] ${label} webhook failed:`, res.status, text);
    }
  } catch (err) {
    console.error(`[slack] ${label} webhook error:`, err);
  }
}
