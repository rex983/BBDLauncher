// Server-side offboarding helpers: the permission gate, case open (which
// snapshots the checklist template + per-app tasks), and the detail/list
// reads the pages and API routes share.

import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canRunOffboarding, isAdmin } from "@/lib/auth/permissions";
import { allowedAppIds } from "@/lib/launcher/access";
import { getCachedApps, getCachedRoleAppAccess } from "@/lib/launcher/cache";
import { createNotification } from "@/lib/notifications/service";
import type {
  CaseDetail,
  CaseSummary,
  ChecklistItem,
  OffboardingCase,
  OffboardingEvent,
  OffboardingReason,
  OffboardingTask,
  PersonRef,
} from "./types";

export const EXPORT_BUCKET = "offboarding-exports";

const CASE_COLUMNS =
  "id, profile_id, employee_name, employee_email, employee_role, employee_office, employee_department, last_day, reason, notes, status, opened_by, closed_by, closed_at, created_at";
const TASK_COLUMNS =
  "id, case_id, item_id, app_id, title, system, category, instructions, requires_note, auto_action, display_order, status, assigned_to, completed_by, completed_at, note";

// Route-handler gate: 401/403 response, or the session.
export async function requireOffboarder(): Promise<Session | NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canRunOffboarding(session.user.role, session.user.is_it)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return session;
}

// People who can be assigned offboarding tasks — the same admin + IT set
// that can open /offboarding, so an assignee can always act on their task.
export async function listOffboarders(): Promise<PersonRef[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, name:full_name, role, is_it, is_active")
    .or("role.eq.admin,is_it.eq.true")
    .order("full_name", { ascending: true });
  return (data || [])
    .filter((p) => p.is_active !== false && canRunOffboarding(p.role, p.is_it))
    .map((p) => ({ id: p.id, name: p.name, email: p.email }));
}

export async function listCases(): Promise<CaseSummary[]> {
  const supabase = createAdminClient();
  const [casesRes, tasksRes] = await Promise.all([
    supabase.from("offboarding_cases").select(CASE_COLUMNS).order("created_at", { ascending: false }),
    supabase.from("offboarding_tasks").select("case_id, status"),
  ]);
  const counts = new Map<string, { total: number; open: number }>();
  for (const t of tasksRes.data || []) {
    const c = counts.get(t.case_id) ?? { total: 0, open: 0 };
    c.total += 1;
    if (t.status === "pending") c.open += 1;
    counts.set(t.case_id, c);
  }
  return ((casesRes.data || []) as OffboardingCase[]).map((c) => ({
    ...c,
    total_tasks: counts.get(c.id)?.total ?? 0,
    open_tasks: counts.get(c.id)?.open ?? 0,
  }));
}

export async function getCaseDetail(caseId: string): Promise<CaseDetail | null> {
  const supabase = createAdminClient();
  const { data: row } = await supabase
    .from("offboarding_cases")
    .select(CASE_COLUMNS)
    .eq("id", caseId)
    .maybeSingle();
  if (!row) return null;
  const c = row as OffboardingCase;

  const [tasksRes, eventsRes, exportsRes, accountRes] = await Promise.all([
    supabase.from("offboarding_tasks").select(TASK_COLUMNS).eq("case_id", caseId).order("display_order"),
    supabase
      .from("offboarding_events")
      .select("id, task_id, event_type, actor_profile_id, actor_name, actor_ip, details, created_at")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true }),
    supabase.storage.from(EXPORT_BUCKET).list(caseId, { sortBy: { column: "created_at", order: "desc" } }),
    c.profile_id
      ? supabase.from("profiles").select("is_active").eq("id", c.profile_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const tasks = (tasksRes.data || []) as OffboardingTask[];
  const events = (eventsRes.data || []) as OffboardingEvent[];

  const ids = new Set<string>();
  for (const t of tasks) {
    if (t.assigned_to) ids.add(t.assigned_to);
    if (t.completed_by) ids.add(t.completed_by);
  }
  if (c.opened_by) ids.add(c.opened_by);
  if (c.closed_by) ids.add(c.closed_by);
  const { data: people } = ids.size
    ? await supabase.from("profiles").select("id, email, name:full_name").in("id", [...ids])
    : { data: [] };

  return {
    case: c,
    tasks,
    events,
    exports: (exportsRes.data || []).map((f) => ({
      path: `${caseId}/${f.name}`,
      created_at: f.created_at ?? "",
      size: (f.metadata?.size as number | undefined) ?? null,
    })),
    people: (people || []) as PersonRef[],
    account: accountRes.data ? { is_active: accountRes.data.is_active !== false } : null,
  };
}

const SSO_APP_INSTRUCTIONS =
  "Signs in through the launcher, so deactivating the launcher account blocks new sign-ins. Also disable any account that exists inside the app itself and reassign records they own.";
const OWN_LOGIN_INSTRUCTIONS = (url: string) =>
  `Has its own login — the launcher can't revoke it. Disable or remove the user directly in the app (${url}) and reassign records they own.`;

export type OpenCaseResult =
  | { ok: true; caseId: string; assignees: string[]; employeeLabel: string }
  | { ok: false; status: number; error: string };

// Opens a case and snapshots its checklist:
//   1. built-in "Deactivate launcher account" (one click)
//   2. one "Revoke access" task per launcher app the person could open
//   3. the active template items
//   4. built-in "Back up launcher records" (one click)
// Template edits after this point never touch an open case.
export async function openCase(params: {
  session: Session;
  profileId: string;
  lastDay: string;
  reason: OffboardingReason;
  notes: string | null;
}): Promise<OpenCaseResult> {
  const supabase = createAdminClient();
  const { data: person } = await supabase
    .from("profiles")
    .select("id, email, name:full_name, role, office, department")
    .eq("id", params.profileId)
    .maybeSingle();
  if (!person) return { ok: false, status: 404, error: "Employee not found" };
  if (person.id === params.session.user.profileId) {
    return { ok: false, status: 400, error: "You can't offboard yourself." };
  }
  if (isAdmin(person.role) && !isAdmin(params.session.user.role)) {
    return { ok: false, status: 403, error: "Only admins can offboard an admin account." };
  }

  const { data: created, error } = await supabase
    .from("offboarding_cases")
    .insert({
      profile_id: person.id,
      employee_name: person.name,
      employee_email: person.email,
      employee_role: person.role,
      employee_office: person.office,
      employee_department: person.department,
      last_day: params.lastDay,
      reason: params.reason,
      notes: params.notes,
      opened_by: params.session.user.profileId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, status: 409, error: "This employee already has an open offboarding case." };
    }
    return { ok: false, status: 500, error: error.message };
  }
  const caseId = created.id as string;

  const [templateRes, apps, accessRows] = await Promise.all([
    supabase
      .from("offboarding_checklist_items")
      .select("id, title, system, category, instructions, requires_note, default_assignee, display_order, is_active")
      .eq("is_active", true)
      .order("display_order"),
    getCachedApps(),
    getCachedRoleAppAccess(),
  ]);
  const template = (templateRes.data || []) as ChecklistItem[];
  const appIds = allowedAppIds(accessRows, person.role, person.office, isAdmin(person.role));
  const personApps = apps.filter((a) => appIds.has(a.id));

  const rows: Array<Record<string, unknown>> = [
    {
      title: "Deactivate BBD Launcher account",
      system: "BBD Launcher",
      category: "access",
      instructions:
        "Signs them out everywhere and blocks sign-in to the launcher and every app it signs into. Their timesheets, time off and incident records are kept.",
      auto_action: "deactivate_launcher",
      display_order: 0,
    },
    ...personApps.map((a, i) => ({
      app_id: a.id,
      title: `Revoke access: ${a.name}`,
      system: a.name,
      category: "access",
      instructions:
        a.sso_type === "none" || a.sso_type === "direct_link"
          ? OWN_LOGIN_INSTRUCTIONS(a.url)
          : SSO_APP_INSTRUCTIONS,
      display_order: 1000 + i,
    })),
    ...template.map((t) => ({
      item_id: t.id,
      title: t.title,
      system: t.system,
      category: t.category,
      instructions: t.instructions,
      requires_note: t.requires_note,
      assigned_to: t.default_assignee,
      display_order: t.display_order,
    })),
    {
      title: "Back up launcher records",
      system: "BBD Launcher",
      category: "data",
      instructions:
        "Saves their profile, timesheets, schedules, time off, incident reports, memo acknowledgements and app-launch history as a JSON file attached to this case.",
      auto_action: "export_launcher_data",
      display_order: 100,
    },
  ].map((r) => ({ case_id: caseId, ...r }));

  const { error: tasksError } = await supabase.from("offboarding_tasks").insert(rows);
  if (tasksError) {
    // Don't leave a half-built case behind.
    await supabase.from("offboarding_cases").delete().eq("id", caseId);
    return { ok: false, status: 500, error: tasksError.message };
  }

  const assignees = [
    ...new Set(template.map((t) => t.default_assignee).filter((id): id is string => !!id)),
  ];
  return { ok: true, caseId, assignees, employeeLabel: person.name || person.email };
}

export function notifyAssignee(params: {
  assigneeId: string;
  caseId: string;
  employeeLabel: string;
  taskTitle?: string;
}): Promise<void> {
  return createNotification({
    userId: params.assigneeId,
    type: "offboarding_task_assigned",
    title: params.taskTitle
      ? `Offboarding task: ${params.taskTitle}`
      : `You have offboarding tasks for ${params.employeeLabel}`,
    body: params.taskTitle ? `For ${params.employeeLabel}` : undefined,
    href: `/offboarding/${params.caseId}`,
    referenceType: "offboarding_case",
    referenceId: params.caseId,
  });
}
