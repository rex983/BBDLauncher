// Client-safe onboarding types. Server code lives in ./service.ts.

// A request's checklist item: its own copy of the default checklist
// (onboarding_template_tasks, editable by admins) made when it was opened.
export interface OnboardingTask {
  id: string;
  title: string;
  done_at: string | null;
  // Who does it (empty = the admins setting up accounts).
  assignees: Person[];
  // Last "Notify on Slack" for this item.
  notified_at: string | null;
  notified_by_name: string | null;
}

export interface Person {
  id: string;
  name: string;
}

export interface TemplateTask {
  id: string;
  title: string;
  assignee_ids: string[];
  assignees: Person[];
}

// How the viewer relates to a request: admins and the manager who opened it
// see everything; people on a checklist item see the name, hire date and
// checklist only, and tick their own items.
export type OnboardingRole = "admin" | "requester" | "assignee";

// The login and documents close this long after a request was opened. The
// checklist stays open until every item is done (training steps come later).
export const ONBOARDING_OPEN_DAYS = 7;

export interface OnboardingDoc {
  name: string; // storage object name inside the request's folder
  filename: string; // what the uploader called it
  size: number;
}

// "none": no password entered yet; "waiting": entered, the manager hasn't
// looked; "viewed": the manager revealed it and it was wiped; "expired":
// never viewed, wiped when the request closed.
export type PasswordStatus = "none" | "waiting" | "viewed" | "expired";

export interface OnboardingRequest {
  id: string;
  created_at: string;
  expires_at: string; // when it closes
  closed: boolean;
  created_by: string;
  created_by_name: string | null;
  first_name: string;
  last_name: string;
  hire_date: string;
  dob: string | null; // null for people who only see their checklist items
  tasks: OnboardingTask[];
  account_email: string | null;
  password_status: PasswordStatus;
  password_set_at: string | null;
  password_viewed_at: string | null;
  role: OnboardingRole; // the viewer's
}

export interface OnboardingDetail extends OnboardingRequest {
  documents: OnboardingDoc[];
}

export function tasksDone(r: Pick<OnboardingRequest, "tasks">): number {
  return r.tasks.filter((t) => t.done_at).length;
}

// Done = past the 7 days and every checklist item ticked. Until then it
// stays on the Open tab.
export function isFinished(r: Pick<OnboardingRequest, "closed" | "tasks">): boolean {
  return r.closed && tasksDone(r) === r.tasks.length;
}

export function onboardingStatus(r: OnboardingRequest): { label: string; variant: "default" | "secondary" | "outline" } {
  if (isFinished(r)) return { label: "Closed", variant: "outline" };
  if (r.closed) {
    const left = r.tasks.length - tasksDone(r);
    return { label: left === 1 ? "1 item left" : `${left} items left`, variant: "secondary" };
  }
  if (r.password_status === "viewed") return { label: "Login viewed", variant: "outline" };
  if (r.password_status === "waiting") return { label: "Login ready", variant: "default" };
  return tasksDone(r) === 0
    ? { label: "Not started", variant: "secondary" }
    : { label: "In progress", variant: "secondary" };
}

// Whole days left before it closes (0 = closed).
export function daysLeft(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000));
}
