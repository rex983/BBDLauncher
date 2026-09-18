// Types + taxonomy for HR incident reports. Same shape philosophy as
// src/lib/timeoff/types.ts — one place for the enums so the zod validator,
// the dropdowns, the Slack notifier, and the display all agree.

export type IncidentSeverity = "low" | "medium" | "high" | "critical";

export type IncidentCategory =
  | "attendance"
  | "performance"
  | "conduct"
  | "safety"
  | "policy"
  | "other";

// Signing state machine. draft → awaiting_manager_sig → awaiting_employee_sig
// → completed. Cancelled is terminal and can be entered from any pre-completed
// state by the reporter or an admin.
export type IncidentStatus =
  | "draft"
  | "awaiting_manager_sig"
  | "awaiting_employee_sig"
  | "completed"
  | "cancelled";

// One uploaded document. Same shape as TimeOffAttachment — `path` is the
// storage key inside the private `incident-attachments` bucket.
export interface IncidentAttachment {
  path: string;
  filename: string;
  size: number;
  mime: string;
}

export const INCIDENT_SEVERITIES: { value: IncidentSeverity; label: string }[] = [
  { value: "low", label: "Low — informational" },
  { value: "medium", label: "Medium — coaching" },
  { value: "high", label: "High — written warning" },
  { value: "critical", label: "Critical — final warning / termination" },
];

export const INCIDENT_SEVERITY_LABEL: Record<IncidentSeverity, string> =
  Object.fromEntries(INCIDENT_SEVERITIES.map((s) => [s.value, s.label])) as Record<
    IncidentSeverity,
    string
  >;

export const INCIDENT_CATEGORIES: { value: IncidentCategory; label: string }[] = [
  { value: "attendance", label: "Attendance & Punctuality" },
  { value: "performance", label: "Performance" },
  { value: "conduct", label: "Conduct & Behavior" },
  { value: "safety", label: "Safety" },
  { value: "policy", label: "Policy Violation" },
  { value: "other", label: "Other" },
];

export const INCIDENT_CATEGORY_LABEL: Record<IncidentCategory, string> =
  Object.fromEntries(INCIDENT_CATEGORIES.map((c) => [c.value, c.label])) as Record<
    IncidentCategory,
    string
  >;

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  draft: "Draft",
  awaiting_manager_sig: "Awaiting your signature",
  awaiting_employee_sig: "Awaiting employee signature",
  completed: "Completed",
  cancelled: "Cancelled",
};

// Standard acknowledgement text every report ships with. Modeled on the
// language HR platforms (BambooHR, Rippling, ADP) use — signature confirms
// receipt/review, not agreement, and preserves the employee's right to
// respond. Kept in one place so a legal review only needs to touch one spot.
export const EMPLOYEE_ACKNOWLEDGEMENT_TEMPLATE = [
  "EMPLOYEE ACKNOWLEDGEMENT",
  "",
  "I acknowledge that I have received and reviewed this incident report. My",
  "signature below confirms receipt and does not necessarily indicate agreement",
  "with the report's contents. I understand that I may submit a written response",
  "which will be attached to this document and retained in my personnel file.",
  "",
  "I understand that repeated or continued conduct of this nature may result in",
  "further corrective action, up to and including termination of employment.",
].join("\n");

// System prompt the LLM sees when asked to draft an incident report. Kept
// terse and directive: the manager provides the who/what/why in the user
// prompt, and the model formats it into HR-appropriate language without
// inventing facts.
export const INCIDENT_DRAFT_SYSTEM_PROMPT = [
  "You are an HR documentation assistant helping a manager write a formal",
  "incident report for an employee's personnel file. The manager will describe",
  "what happened in plain language; your job is to convert it into a clear,",
  "professional, and factual write-up suitable for signature by both parties.",
  "",
  "Rules:",
  "1. Report ONLY the facts the manager provided. Do not invent details,",
  "   attribute motive, or add speculation.",
  "2. Use neutral, professional language. Avoid emotive words, accusations,",
  "   or moral judgements. Describe observable behavior, not character.",
  "3. Structure the document with these sections, using plain text headings:",
  "     INCIDENT REPORT",
  "     Employee: <name>",
  "     Date of Incident: <date the manager mentioned, or blank>",
  "     Category: <the selected category>",
  "     Severity: <the selected severity>",
  "     ",
  "     SUMMARY",
  "     <2-4 sentence summary of what happened>",
  "     ",
  "     DETAILS",
  "     <expanded factual narrative from the manager's description>",
  "     ",
  "     POLICY / EXPECTATION REFERENCED",
  "     <if the manager mentioned a policy or expectation; otherwise omit this section>",
  "     ",
  "     CORRECTIVE ACTION / EXPECTATIONS GOING FORWARD",
  "     <what the employee is expected to do differently, if the manager provided this>",
  "4. Do NOT include a signature block, an acknowledgement statement, or a",
  "   'signed by' line — those are appended by the system.",
  "5. Do NOT wrap the output in markdown code fences or add commentary. Output",
  "   only the plain-text document body.",
  "6. Keep the tone measured. Even for a 'critical' severity, describe conduct",
  "   factually rather than editorializing.",
].join("\n");
