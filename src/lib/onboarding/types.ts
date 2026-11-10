// Client-safe onboarding types. Server code lives in ./service.ts.

// A request's checklist item: its own copy of the default checklist
// (onboarding_template_tasks, editable by admins) made when it was opened.
export interface OnboardingTask {
  id: string;
  title: string;
  done_at: string | null;
}

export interface TemplateTask {
  id: string;
  title: string;
}

// Every request deletes itself this long after it was opened.
export const ONBOARDING_TTL_DAYS = 7;

export interface OnboardingDoc {
  name: string; // storage object name inside the request's folder
  filename: string; // what the uploader called it
  size: number;
}

// "none": no password entered yet; "waiting": entered, the manager hasn't
// looked; "viewed": the manager revealed it and it was wiped.
export type PasswordStatus = "none" | "waiting" | "viewed";

export interface OnboardingRequest {
  id: string;
  created_at: string;
  expires_at: string;
  created_by: string;
  created_by_name: string | null;
  first_name: string;
  last_name: string;
  hire_date: string;
  dob: string;
  tasks: OnboardingTask[];
  account_email: string | null;
  password_status: PasswordStatus;
  password_set_at: string | null;
  password_viewed_at: string | null;
}

export interface OnboardingDetail extends OnboardingRequest {
  documents: OnboardingDoc[];
}

export function tasksDone(r: Pick<OnboardingRequest, "tasks">): number {
  return r.tasks.filter((t) => t.done_at).length;
}

export function onboardingStatus(r: OnboardingRequest): { label: string; variant: "default" | "secondary" | "outline" } {
  if (r.password_status === "viewed") return { label: "Login viewed", variant: "outline" };
  if (r.password_status === "waiting") return { label: "Login ready", variant: "default" };
  return tasksDone(r) === 0
    ? { label: "Not started", variant: "secondary" }
    : { label: "In progress", variant: "secondary" };
}

// Whole days left before it deletes itself (0 = today).
export function daysLeft(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000));
}
