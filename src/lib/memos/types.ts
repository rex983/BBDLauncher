// Types + taxonomy for office memos. Same shape philosophy as
// src/lib/incidents/types.ts — one place for the enums so zod schemas,
// dropdowns, Slack notifier, and display strings all stay in sync.

export type MemoCategory =
  | "policy"
  | "procedure"
  | "safety"
  | "benefits"
  | "announcement"
  | "other";

export type MemoPriority = "informational" | "important" | "mandatory";

export type MemoAcknowledgementMode =
  | "informational"
  | "read_receipt"
  | "signed";

export type MemoStatus = "draft" | "published" | "archived";

export type MemoAudienceScope = "company" | "office" | "department" | "custom";

// Same shape as IncidentAttachment — {path, filename, size, mime}. Kept in
// its own interface so the storage bucket difference stays visible in types.
export interface MemoAttachment {
  path: string;
  filename: string;
  size: number;
  mime: string;
}

export const MEMO_CATEGORIES: { value: MemoCategory; label: string }[] = [
  { value: "policy", label: "Policy" },
  { value: "procedure", label: "Procedure" },
  { value: "safety", label: "Safety" },
  { value: "benefits", label: "Benefits & HR" },
  { value: "announcement", label: "Announcement" },
  { value: "other", label: "Other" },
];

export const MEMO_CATEGORY_LABEL: Record<MemoCategory, string> =
  Object.fromEntries(MEMO_CATEGORIES.map((c) => [c.value, c.label])) as Record<
    MemoCategory,
    string
  >;

export const MEMO_PRIORITIES: { value: MemoPriority; label: string }[] = [
  { value: "informational", label: "Informational" },
  { value: "important", label: "Important" },
  { value: "mandatory", label: "Mandatory" },
];

export const MEMO_PRIORITY_LABEL: Record<MemoPriority, string> =
  Object.fromEntries(MEMO_PRIORITIES.map((p) => [p.value, p.label])) as Record<
    MemoPriority,
    string
  >;

export const MEMO_ACK_MODES: {
  value: MemoAcknowledgementMode;
  label: string;
  hint: string;
}[] = [
  {
    value: "informational",
    label: "Informational",
    hint: "Just a notification. No read receipt or signature required.",
  },
  {
    value: "read_receipt",
    label: "Read receipt",
    hint: "Marks read when the recipient opens the memo. No signature.",
  },
  {
    value: "signed",
    label: "Signed acknowledgement",
    hint: "Recipient must type their full name to acknowledge. Same hash chain as incident reports.",
  },
];

export const MEMO_ACK_MODE_LABEL: Record<MemoAcknowledgementMode, string> =
  Object.fromEntries(
    MEMO_ACK_MODES.map((m) => [m.value, m.label]),
  ) as Record<MemoAcknowledgementMode, string>;

export const MEMO_STATUS_LABEL: Record<MemoStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export const MEMO_AUDIENCE_SCOPES: {
  value: MemoAudienceScope;
  label: string;
  hint: string;
}[] = [
  { value: "company", label: "Whole company", hint: "Every active employee." },
  { value: "office", label: "Specific office", hint: "Everyone at one office." },
  {
    value: "department",
    label: "Specific department",
    hint: "Everyone in one department (optionally scoped to one office).",
  },
  {
    value: "custom",
    label: "Custom list",
    hint: "Hand-picked list of employees.",
  },
];

// Standard acknowledgement text for signed memos. Kept generic (unlike
// incident reports which specifically reference disciplinary action).
export const MEMO_ACKNOWLEDGEMENT_TEMPLATE = [
  "MEMO ACKNOWLEDGEMENT",
  "",
  "I acknowledge that I have received and reviewed this memo. My signature",
  "below confirms receipt and understanding of its contents.",
].join("\n");

// Display helper for the sequential ID column. Prefixed with `M-` (vs.
// incident reports' `#`) so a Slack or email reference disambiguates at a
// glance which system a number belongs to.
export function formatMemoNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return `M-${String(n).padStart(4, "0")}`;
}
