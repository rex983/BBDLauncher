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
  AutoAction,
} from "./types";

export const EXPORT_BUCKET = "offboarding-exports";

const CASE_COLUMNS =
  "id, profile_id, employee_name, employee_email, employee_role, employee_office, employee_department, last_day, reason, notes, status, opened_by, closed_by, closed_at, created_at";
const TASK_COLUMNS =
  "id, case_id, item_id, app_id, title, system, section, instructions, requires_note, auto_action, display_order, status, started_by, started_at, completed_by, completed_at, note";

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
    if (t.status === "pending" || t.status === "in_progress") c.open += 1;
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

  const [tasksRes, eventsRes, exportsRes, accountRes, sectionsRes] = await Promise.all([
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
    supabase.from("offboarding_sections").select("name").order("display_order"),
  ]);

  const tasks = (tasksRes.data || []) as OffboardingTask[];
  // The checklist's sections (so empty ones show and accept tasks), then any
  // section only this case still has.
  const sections = [
    ...new Set([...(sectionsRes.data || []).map((s) => s.name as string), ...tasks.map((t) => t.section)]),
  ];
  const events = (eventsRes.data || []) as OffboardingEvent[];

  const ids = new Set<string>();
  for (const t of tasks) {
    if (t.completed_by) ids.add(t.completed_by);
    if (t.started_by) ids.add(t.started_by);
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
    sections,
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

type PersonForApps = { id: string; role: string; office: string | null };

// Launcher apps the person could open: their office × role grid plus apps
// granted to them by name.
async function appsForPerson(person: PersonForApps) {
  const [apps, accessRows, userAccessRows] = await Promise.all([
    getCachedApps(),
    getCachedRoleAppAccess(),
    getCachedUserAccess(),
  ]);
  const appIds = allowedAppIds(accessRows, person.role, person.office, isAdmin(person.role));
  const namedAppIds = personalGrants(userAccessRows, person.id).apps;
  return apps.filter((a) => appIds.has(a.id) || namedAppIds.has(a.id));
}

/** A case task as the checklist would create it, in checklist order. */
export interface ExpectedTask {
  item_id: string;
  app_id: string | null;
  section: string;
  title: string;
  system: string | null;
  instructions: string | null;
  requires_note: boolean;
  auto_action: AutoAction | null;
}

// The active checklist turned into case tasks, section by section. A
// "revoke_apps" item becomes one task per launcher app the person can open.
function expectedTasks(
  template: { sections: OffboardingSection[]; items: ChecklistItem[] },
  personApps: Awaited<ReturnType<typeof appsForPerson>>,
): ExpectedTask[] {
  const out: ExpectedTask[] = [];
  for (const section of template.sections) {
    for (const item of template.items) {
      if (item.section_id !== section.id || !item.is_active) continue;
      if (item.auto_action === "revoke_apps") {
        for (const a of personApps) {
          out.push({
            item_id: item.id,
            app_id: a.id,
            section: section.name,
            title: `Revoke access: ${a.name}`,
            system: a.name,
            instructions:
              a.sso_type === "none" || a.sso_type === "direct_link"
                ? OWN_LOGIN_INSTRUCTIONS(a.url)
                : SSO_APP_INSTRUCTIONS,
            requires_note: false,
            auto_action: null,
          });
        }
        continue;
      }
      out.push({
        item_id: item.id,
        app_id: null,
        section: section.name,
        title: item.title,
        system: item.system,
        instructions: item.instructions,
        requires_note: item.requires_note,
        auto_action: item.auto_action,
      });
    }
  }
  return out;
}

export type OpenCaseResult =
  | { ok: true; caseId: string }
  | { ok: false; status: number; error: string };

// Opens a case and snapshots the active checklist. Template edits after this
// point only reach an open case through syncCaseToChecklist.
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

  const [template, personApps] = await Promise.all([getTemplate(), appsForPerson(person)]);
  const rows = expectedTasks(template, personApps).map((r, i) => ({
    ...r,
    case_id: caseId,
    display_order: i * 10,
  }));

  if (rows.length) {
    // defaultToNull:false — any column a row leaves out takes its table default.
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

export type SyncResult =
  | { ok: true; updated: number; added: number; removed: string[]; kept: number }
  | { ok: false; status: number; error: string };

// Makes an open case match the checklist exactly: same sections, order,
// wording and tasks. Existing tasks are matched by checklist item (then
// built-in action, then title) and keep their status, note and who did them.
// Checklist tasks the case is missing are added. Pending tasks the checklist
// no longer has are removed; finished ones are kept at the end as record.
export async function syncCaseToChecklist(caseId: string): Promise<SyncResult> {
  const supabase = createAdminClient();
  const { data: c } = await supabase
    .from("offboarding_cases")
    .select("id, profile_id, employee_role, employee_office, status")
    .eq("id", caseId)
    .maybeSingle();
  if (!c) return { ok: false, status: 404, error: "Not found" };
  if (c.status !== "open") return { ok: false, status: 409, error: "Reopen the case first." };

  const [template, tasksRes] = await Promise.all([
    getTemplate(),
    supabase.from("offboarding_tasks").select(TASK_COLUMNS).eq("case_id", caseId).order("display_order"),
  ]);
  const personApps = c.profile_id
    ? await appsForPerson({ id: c.profile_id, role: c.employee_role ?? "", office: c.employee_office })
    : [];
  const expected = expectedTasks(template, personApps);
  const tasks = (tasksRes.data || []) as OffboardingTask[];

  const unused = new Set(tasks.map((t) => t.id));
  const take = (pred: (t: OffboardingTask) => boolean) => {
    const t = tasks.find((x) => unused.has(x.id) && pred(x));
    if (t) unused.delete(t.id);
    return t;
  };
  const norm = (v: string) => v.trim().toLowerCase();

  const updates: Array<{ id: string; values: Record<string, unknown> }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  expected.forEach((e, i) => {
    const match = e.app_id
      ? take((t) => t.app_id === e.app_id)
      : take((t) => t.item_id === e.item_id && !t.app_id) ??
        (e.auto_action ? take((t) => t.auto_action === e.auto_action) : undefined) ??
        take((t) => !t.app_id && norm(t.title) === norm(e.title));
    const values = { ...e, display_order: i * 10 };
    if (match) updates.push({ id: match.id, values });
    else inserts.push({ ...values, case_id: caseId });
  });

  const leftovers = tasks.filter((t) => unused.has(t.id));
  const toRemove = leftovers.filter((t) => t.status === "pending");
  const toKeep = leftovers.filter((t) => t.status !== "pending");
  toKeep.forEach((t, i) => updates.push({ id: t.id, values: { display_order: (expected.length + i) * 10 } }));

  const results = await Promise.all([
    ...updates.map((u) => supabase.from("offboarding_tasks").update(u.values).eq("id", u.id)),
    inserts.length
      ? supabase.from("offboarding_tasks").insert(inserts, { defaultToNull: false })
      : Promise.resolve({ error: null }),
    toRemove.length
      ? supabase.from("offboarding_tasks").delete().in("id", toRemove.map((t) => t.id))
      : Promise.resolve({ error: null }),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, status: 500, error: failed.error.message };

  return {
    ok: true,
    updated: updates.length - toKeep.length,
    added: inserts.length,
    removed: toRemove.map((t) => t.title),
    kept: toKeep.length,
  };
}

// Saves a drag on a case and mirrors it to the checklist so every
// offboarding keeps the same layout: the case's tasks get their new section
// and order, the checklist's sections take the case's section order, and
// each checklist task linked to a case task moves to the same section and
// position. Returns the tasks whose section changed (for the log).
export async function saveCaseLayout(
  caseId: string,
  layout: { sections: string[]; tasks: Array<{ id: string; section: string }> },
): Promise<{ ok: true; moved: Array<{ title: string; from: string; to: string }> } | { ok: false; error: string }> {
  const supabase = createAdminClient();
  const [tasksRes, template] = await Promise.all([
    supabase.from("offboarding_tasks").select(TASK_COLUMNS).eq("case_id", caseId),
    getTemplate(),
  ]);
  const byId = new Map(((tasksRes.data || []) as OffboardingTask[]).map((t) => [t.id, t]));
  const ordered = layout.tasks.filter((t) => byId.has(t.id));
  const moved = ordered
    .filter((t) => byId.get(t.id)!.section !== t.section)
    .map((t) => ({ title: byId.get(t.id)!.title, from: byId.get(t.id)!.section, to: t.section }));

  // Case tasks.
  const writes: Array<PromiseLike<{ error: { message: string } | null }>> = ordered.map((t, i) =>
    supabase.from("offboarding_tasks").update({ section: t.section, display_order: i * 10 }).eq("id", t.id),
  );

  // Checklist sections: the case's order first, the rest after.
  const sectionId = new Map(template.sections.map((s) => [s.name, s.id]));
  const sectionOrder = [
    ...layout.sections.filter((n) => sectionId.has(n)).map((n) => sectionId.get(n)!),
    ...template.sections.map((s) => s.id).filter((id) => !layout.sections.some((n) => sectionId.get(n) === id)),
  ];
  sectionOrder.forEach((id, i) =>
    writes.push(supabase.from("offboarding_sections").update({ display_order: i }).eq("id", id)),
  );

  // Checklist items linked to case tasks (by item, built-in action, then title).
  const norm = (v: string) => v.trim().toLowerCase();
  const linked: Array<{ itemId: string; section: string }> = [];
  const used = new Set<string>();
  for (const t of ordered) {
    const task = byId.get(t.id)!;
    if (task.app_id) continue;
    const item =
      template.items.find((i) => !used.has(i.id) && i.id === task.item_id) ??
      (task.auto_action ? template.items.find((i) => !used.has(i.id) && i.auto_action === task.auto_action) : undefined) ??
      template.items.find((i) => !used.has(i.id) && norm(i.title) === norm(task.title));
    if (!item || !sectionId.has(t.section)) continue;
    used.add(item.id);
    linked.push({ itemId: item.id, section: t.section });
  }
  for (const name of new Set(linked.map((l) => l.section))) {
    const sid = sectionId.get(name)!;
    const first = linked.filter((l) => l.section === name).map((l) => l.itemId);
    // Checklist-only items in this section keep their order, after the linked ones.
    const rest = template.items.filter((i) => i.section_id === sid && !used.has(i.id)).map((i) => i.id);
    [...first, ...rest].forEach((id, i) =>
      writes.push(
        supabase.from("offboarding_checklist_items").update({ section_id: sid, display_order: i }).eq("id", id),
      ),
    );
  }

  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };
  return { ok: true, moved };
}
