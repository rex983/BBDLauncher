// Server-side offboarding helpers: the permission gate, case open (which
// snapshots the checklist template + per-app tasks), and the detail/list
// reads the pages and API routes share.

import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canRunOffboarding, isAdmin } from "@/lib/auth/permissions";
import { allowedAppIds, personalGrants } from "@/lib/launcher/access";
import { getCachedApps, getCachedRoleAppAccess, getCachedUserAccess } from "@/lib/launcher/cache";
import type {
  CaseDetail,
  CaseSummary,
  ChecklistItem,
  OffboardingCase,
  OffboardingEvent,
  OffboardingReason,
  OffboardingSection,
  OffboardingTask,
  PersonRef,
} from "./types";

export const EXPORT_BUCKET = "offboarding-exports";

const CASE_COLUMNS =
  "id, profile_id, employee_name, employee_email, employee_role, employee_office, employee_department, last_day, reason, notes, status, opened_by, closed_by, closed_at, created_at";
const TASK_COLUMNS =
  "id, case_id, item_id, app_id, title, system, section, instructions, requires_note, auto_action, display_order, status, completed_by, completed_at, note";

// Route-handler gate: 401/403 response, or the session.
export async function requireOffboarder(): Promise<Session | NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canRunOffboarding(session.user.role, session.user.can_offboard)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return session;
}

const ITEM_COLUMNS =
  "id, section_id, title, system, instructions, requires_note, auto_action, display_order, is_active";

// The checklist template: sections top to bottom, items ordered within each.
export async function getTemplate(): Promise<{ sections: OffboardingSection[]; items: ChecklistItem[] }> {
  const supabase = createAdminClient();
  const [sectionsRes, itemsRes] = await Promise.all([
    supabase.from("offboarding_sections").select("id, name, display_order").order("display_order"),
    supabase.from("offboarding_checklist_items").select(ITEM_COLUMNS).order("display_order"),
  ]);
  return {
    sections: (sectionsRes.data || []) as OffboardingSection[],
    items: (itemsRes.data || []) as ChecklistItem[],
  };
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
    if (t.completed_by) ids.add(t.completed_by);
  }
  // Older cases logged assignments; keep those log rows readable.
  for (const e of events) {
    if (e.event_type === "task_assigned" && typeof e.details?.to === "string") ids.add(e.details.to);
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
  | { ok: true; caseId: string }
  | { ok: false; status: number; error: string };

// Opens a case and snapshots the active checklist template, section by
// section. A "revoke_apps" item becomes one task per launcher app the person
// could open. Template edits after this point never touch an open case.
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

  const [template, apps, accessRows, userAccessRows] = await Promise.all([
    getTemplate(),
    getCachedApps(),
    getCachedRoleAppAccess(),
    getCachedUserAccess(),
  ]);
  const appIds = allowedAppIds(accessRows, person.role, person.office, isAdmin(person.role));
  const namedAppIds = personalGrants(userAccessRows, person.id).apps;
  const personApps = apps.filter((a) => appIds.has(a.id) || namedAppIds.has(a.id));

  const rows: Array<Record<string, unknown>> = [];
  const push = (r: Record<string, unknown>) =>
    rows.push({ case_id: caseId, requires_note: false, ...r, display_order: rows.length * 10 });
  for (const section of template.sections) {
    for (const item of template.items) {
      if (item.section_id !== section.id || !item.is_active) continue;
      if (item.auto_action === "revoke_apps") {
        for (const a of personApps) {
          push({
            item_id: item.id,
            app_id: a.id,
            section: section.name,
            title: `Revoke access: ${a.name}`,
            system: a.name,
            instructions:
              a.sso_type === "none" || a.sso_type === "direct_link"
                ? OWN_LOGIN_INSTRUCTIONS(a.url)
                : SSO_APP_INSTRUCTIONS,
          });
        }
        continue;
      }
      push({
        item_id: item.id,
        section: section.name,
        title: item.title,
        system: item.system,
        instructions: item.instructions,
        requires_note: item.requires_note,
        auto_action: item.auto_action,
      });
    }
  }

  if (rows.length) {
    // Rows don't all set the same columns; let missing ones take their defaults.
    const { error: tasksError } = await supabase
      .from("offboarding_tasks")
      .insert(rows, { defaultToNull: false });
    if (tasksError) {
      // Don't leave a half-built case behind.
      await supabase.from("offboarding_cases").delete().eq("id", caseId);
      return { ok: false, status: 500, error: tasksError.message };
    }
  }

  return { ok: true, caseId };
}
