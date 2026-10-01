import type { BadgeVariant } from "@/lib/badge-variant";

export const OFFBOARDING_CATEGORIES = [
  { value: "access", label: "Revoke access" },
  { value: "data", label: "Save & back up data" },
  { value: "hardware", label: "Equipment" },
  { value: "hr", label: "HR & payroll" },
] as const;
export type OffboardingCategory = (typeof OFFBOARDING_CATEGORIES)[number]["value"];
export const OFFBOARDING_CATEGORY_VALUES = OFFBOARDING_CATEGORIES.map((c) => c.value) as [
  OffboardingCategory,
  ...OffboardingCategory[],
];
export const OFFBOARDING_CATEGORY_LABEL = Object.fromEntries(
  OFFBOARDING_CATEGORIES.map((c) => [c.value, c.label]),
) as Record<OffboardingCategory, string>;

export const OFFBOARDING_REASONS = [
  { value: "resigned", label: "Resigned" },
  { value: "terminated", label: "Terminated" },
  { value: "laid_off", label: "Laid off" },
  { value: "contract_end", label: "Contract ended" },
  { value: "other", label: "Other" },
] as const;
export type OffboardingReason = (typeof OFFBOARDING_REASONS)[number]["value"];
export const OFFBOARDING_REASON_VALUES = OFFBOARDING_REASONS.map((r) => r.value) as [
  OffboardingReason,
  ...OffboardingReason[],
];
export const OFFBOARDING_REASON_LABEL = Object.fromEntries(
  OFFBOARDING_REASONS.map((r) => [r.value, r.label]),
) as Record<OffboardingReason, string>;

export type CaseStatus = "open" | "completed" | "cancelled";
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  open: "Open",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const CASE_STATUS_VARIANT: Record<CaseStatus, BadgeVariant> = {
  open: "default",
  completed: "secondary",
  cancelled: "outline",
};

export const TASK_STATUSES = ["pending", "done", "not_applicable"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  done: "Done",
  not_applicable: "N/A",
};

// Built-in actions the launcher performs itself (src/lib/offboarding/actions.ts).
export type AutoAction = "deactivate_launcher" | "export_launcher_data";

export interface ChecklistItem {
  id: string;
  title: string;
  system: string;
  category: OffboardingCategory;
  instructions: string | null;
  requires_note: boolean;
  default_assignee: string | null;
  display_order: number;
  is_active: boolean;
}

export interface PersonRef {
  id: string;
  name: string | null;
  email: string;
}

export interface OffboardingCase {
  id: string;
  profile_id: string | null;
  employee_name: string | null;
  employee_email: string;
  employee_role: string | null;
  employee_office: string | null;
  employee_department: string | null;
  last_day: string;
  reason: OffboardingReason;
  notes: string | null;
  status: CaseStatus;
  opened_by: string | null;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
}

export interface CaseSummary extends OffboardingCase {
  total_tasks: number;
  open_tasks: number;
}

export interface OffboardingTask {
  id: string;
  case_id: string;
  item_id: string | null;
  app_id: string | null;
  title: string;
  system: string;
  category: OffboardingCategory;
  instructions: string | null;
  requires_note: boolean;
  auto_action: AutoAction | null;
  display_order: number;
  status: TaskStatus;
  assigned_to: string | null;
  completed_by: string | null;
  completed_at: string | null;
  note: string | null;
}

export interface OffboardingEvent {
  id: string;
  task_id: string | null;
  event_type: string;
  actor_profile_id: string | null;
  actor_name: string | null;
  actor_ip: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface CaseExport {
  path: string;
  created_at: string;
  size: number | null;
}

export interface CaseDetail {
  case: OffboardingCase;
  tasks: OffboardingTask[];
  events: OffboardingEvent[];
  exports: CaseExport[];
  /** Everyone referenced by the case (assignees, actors) for name lookup. */
  people: PersonRef[];
  /** Live state of the employee's launcher account (null if profile deleted). */
  account: { is_active: boolean } | null;
}

export const EVENT_LABEL: Record<string, string> = {
  case_opened: "Opened offboarding",
  case_updated: "Updated case details",
  case_completed: "Closed case as completed",
  case_cancelled: "Cancelled case",
  case_reopened: "Reopened case",
  task_done: "Completed",
  task_not_applicable: "Marked N/A",
  task_reopened: "Reopened",
  task_assigned: "Assigned",
  task_note: "Updated note",
  task_added: "Added task",
  launcher_deactivated: "Deactivated launcher account",
  data_exported: "Backed up launcher records",
  export_downloaded: "Downloaded backup",
};
