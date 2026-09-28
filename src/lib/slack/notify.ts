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

// ---------------------------------------------------------------------
// Block Kit builders. Slack "attachments" are the legacy formatting layer
// but still the easiest way to get a colored side-bar per message; Blocks
// alone would need a context+section combo without the color.
// ---------------------------------------------------------------------

type Block = Record<string, unknown>;

const mrkdwn = (text: string) => ({ type: "mrkdwn", text });

// "*Label*\nvalue" — the standard labelled field.
const field = (label: string, value: string | number) => `*${label}*\n${value}`;

const headerSection = (...lines: string[]): Block => ({
  type: "section",
  text: mrkdwn(lines.join("\n")),
});

// Falsy entries are dropped so optional fields can be written inline.
const fieldsSection = (...fields: (string | false)[]): Block => ({
  type: "section",
  fields: fields.filter((f): f is string => !!f).map(mrkdwn),
});

const linkButton = (text: string, url: string, primary = true): Block => ({
  type: "actions",
  elements: [
    {
      type: "button",
      text: { type: "plain_text", text },
      url,
      ...(primary ? { style: "primary" } : {}),
    },
  ],
});

const contextNote = (text: string): Block => ({ type: "context", elements: [mrkdwn(text)] });

const fileCount = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

const person = (name: string | null, email: string | null) =>
  `${name || "Unknown"}\n\`${email || ""}\``;

// Post one colored-attachment message to the webhook in `envVar`. No-op
// when the webhook isn't configured.
async function send(
  envVar: string,
  label: string,
  text: string,
  color: string,
  blocks: Block[],
): Promise<void> {
  const url = process.env[envVar];
  if (!url) return;
  await postSlack(url, { text, attachments: [{ color, blocks }] }, label);
}

// Admin-only HARD-DELETE notifications. Fired from the purge endpoints —
// once the row is gone this Slack message is the only surviving audit
// trail, so it snapshots enough context to reconstruct what was deleted.
const PURGED_COLOR = "#dc2626";

function purgedBlocks(p: {
  heading: string;
  numberLabel: string;
  title: string;
  actorName: string;
  fields: (string | false)[];
  note: string;
}): Block[] {
  return [
    headerSection(
      `*${p.heading} PURGED (hard delete)*`,
      `*${p.numberLabel}* — ${p.title}`,
      `Actioned by *${p.actorName}*.`,
    ),
    fieldsSection(...p.fields),
    contextNote(p.note),
  ];
}

// =====================================================================
// Time-off requests — SLACK_TIMEOFF_WEBHOOK_URL.
// =====================================================================

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
  const dateLine = p.startDate === p.endDate
    ? fmtDate(p.startDate)
    : `${fmtDate(p.startDate)} → ${fmtDate(p.endDate)}`;

  const length = p.fullDay ? "Full day(s)" : `${p.hours}h`;
  const typeLine = p.subcategory
    ? `${TIME_OFF_TYPE_LABEL[p.type]} · ${p.subcategory}`
    : TIME_OFF_TYPE_LABEL[p.type];

  await send(
    "SLACK_TIMEOFF_WEBHOOK_URL",
    "time-off",
    `New time-off request from ${p.employeeName}`,
    TYPE_COLOR[p.type],
    [
      headerSection(`*New time-off request*`, `*${p.employeeName}* \`${p.employeeEmail}\``),
      fieldsSection(
        field("Type", typeLine),
        field("Length", length),
        field("Dates", dateLine),
        p.attachmentCount > 0 && field("Attachments", fileCount(p.attachmentCount)),
      ),
      ...(p.reason ? [headerSection(field("Notes", `>${p.reason.replace(/\n/g, "\n>")}`))] : []),
      linkButton("Review in launcher", `${LAUNCHER_URL}/management/timeoff`),
    ],
  );
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
  await send(
    "SLACK_INCIDENT_WEBHOOK_URL",
    "incident-submitted",
    `New incident report filed for ${p.employeeName}`,
    INCIDENT_SEVERITY_COLOR[p.severity],
    [
      headerSection(`*New incident report*`, `*${p.title}*`, `Filed by ${p.reporterName}`),
      fieldsSection(
        field("Employee", `${p.employeeName}\n\`${p.employeeEmail}\``),
        field("Severity", INCIDENT_SEVERITY_LABEL[p.severity]),
        field("Category", INCIDENT_CATEGORY_LABEL[p.category]),
        p.attachmentCount > 0 && field("Attachments", fileCount(p.attachmentCount)),
      ),
      linkButton("Open in launcher", `${LAUNCHER_URL}/management/incidents/${p.incidentId}`),
    ],
  );
}

export interface IncidentCompletedPayload {
  incidentId: string;
  employeeName: string;
  title: string;
  severity: IncidentSeverity;
}

export async function notifyIncidentCompleted(p: IncidentCompletedPayload): Promise<void> {
  await send(
    "SLACK_INCIDENT_WEBHOOK_URL",
    "incident-completed",
    `Incident report signed by ${p.employeeName}`,
    INCIDENT_SEVERITY_COLOR[p.severity],
    [
      headerSection(
        `*Incident report signed*`,
        `*${p.title}*`,
        `${p.employeeName} has acknowledged this report.`,
      ),
      linkButton(
        "View signed report",
        `${LAUNCHER_URL}/management/incidents/${p.incidentId}`,
        false,
      ),
    ],
  );
}

export interface IncidentPurgedPayload {
  numberLabel: string;
  title: string;
  employeeName: string | null;
  employeeEmail: string | null;
  actorName: string;
  attachmentCount: number;
  createdAt: string;
  priorStatus: string;
}

export async function notifyIncidentPurged(p: IncidentPurgedPayload): Promise<void> {
  await send(
    "SLACK_INCIDENT_WEBHOOK_URL",
    "incident-purged",
    `Incident report ${p.numberLabel} purged by ${p.actorName}`,
    PURGED_COLOR,
    purgedBlocks({
      heading: "Incident report",
      numberLabel: p.numberLabel,
      title: p.title,
      actorName: p.actorName,
      fields: [
        field("Employee", person(p.employeeName, p.employeeEmail)),
        field("Prior status", p.priorStatus),
        field("Filed", new Date(p.createdAt).toLocaleString()),
        p.attachmentCount > 0 && field("Attachments purged", p.attachmentCount),
      ],
      note: "This record has been permanently deleted. The row, its audit-event log, and all attachment files are gone.",
    }),
  );
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
  const titleLine = p.numberLabel ? `${p.numberLabel} · ${p.title}` : p.title;

  await send(
    "SLACK_MEMO_WEBHOOK_URL",
    "memo-published",
    `New memo from ${p.authorName}: ${p.title}`,
    MEMO_PRIORITY_COLOR[p.priority],
    [
      headerSection(`*New memo published*`, `*${titleLine}*`, `Author: ${p.authorName}`),
      fieldsSection(
        field("Category", MEMO_CATEGORY_LABEL[p.category]),
        field("Priority", MEMO_PRIORITY_LABEL[p.priority]),
        field("Audience", p.audienceLabel),
        field("Recipients", p.recipientCount),
        field("Acknowledgement", MEMO_ACK_MODE_LABEL[p.ackMode]),
      ),
      linkButton("Open in launcher", `${LAUNCHER_URL}/management/memos`),
    ],
  );
}

export interface MemoPurgedPayload {
  numberLabel: string;
  title: string;
  authorName: string | null;
  authorEmail: string | null;
  actorName: string;
  attachmentCount: number;
  recipientCount: number;
  createdAt: string;
  priorStatus: string;
}

export async function notifyMemoPurged(p: MemoPurgedPayload): Promise<void> {
  await send(
    "SLACK_MEMO_WEBHOOK_URL",
    "memo-purged",
    `Memo ${p.numberLabel} purged by ${p.actorName}`,
    PURGED_COLOR,
    purgedBlocks({
      heading: "Memo",
      numberLabel: p.numberLabel,
      title: p.title,
      actorName: p.actorName,
      fields: [
        field("Author", person(p.authorName, p.authorEmail)),
        field("Prior status", p.priorStatus),
        field("Recipients erased", p.recipientCount),
        field("Created", new Date(p.createdAt).toLocaleString()),
        p.attachmentCount > 0 && field("Attachments purged", p.attachmentCount),
      ],
      note: "This memo, its recipient roster, audit log, and attachment files are permanently gone.",
    }),
  );
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
