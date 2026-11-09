// Client-safe onboarding types. Server code lives in ./service.ts.

export const ONBOARDING_STEPS = [
  { key: "laptop", label: "Prepare laptop" },
  { key: "gmail", label: "Create Gmail account" },
  { key: "strapi", label: "Create Strapi account" },
  { key: "launcher", label: "Create launcher account" },
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]["key"];
export const ONBOARDING_STEP_KEYS = ONBOARDING_STEPS.map((s) => s.key) as [OnboardingStep, ...OnboardingStep[]];

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
  steps: Record<OnboardingStep, string | null>;
  account_email: string | null;
  password_status: PasswordStatus;
  password_set_at: string | null;
  password_viewed_at: string | null;
}

export interface OnboardingDetail extends OnboardingRequest {
  documents: OnboardingDoc[];
}

export function stepsDone(r: Pick<OnboardingRequest, "steps">): number {
  return ONBOARDING_STEP_KEYS.filter((k) => r.steps[k]).length;
}

export function onboardingStatus(r: OnboardingRequest): { label: string; variant: "default" | "secondary" | "outline" } {
  if (r.password_status === "viewed") return { label: "Login viewed", variant: "outline" };
  if (r.password_status === "waiting") return { label: "Login ready", variant: "default" };
  return stepsDone(r) === 0
    ? { label: "Not started", variant: "secondary" }
    : { label: "In progress", variant: "secondary" };
}

// Whole days left before it deletes itself (0 = today).
export function daysLeft(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000));
}
