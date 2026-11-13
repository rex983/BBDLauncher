// Server-side onboarding helpers: the permission gate, scoped reads, closing
// requests after 30 days, and deleting one (with its documents and bells).
// See supabase/migrations/065_onboarding.sql for what is (not) kept.

import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUseOnboarding, isAdmin } from "@/lib/auth/permissions";
import { createNotifications } from "@/lib/notifications/service";
import { slackApi, slackUserId } from "@/lib/slack/bot";
import { slackName } from "@/lib/offboarding/notify";
import {
  type OnboardingDetail,
  type OnboardingDoc,
  type OnboardingRequest,
  type OnboardingRole,
  type TemplateTask,
} from "./types";

export const ONBOARDING_BUCKET = "onboarding-docs";
const REFERENCE_TYPE = "onboarding_request";

const COLUMNS =
  "id, created_at, expires_at, created_by, created_by_name, first_name, last_name, hire_date, dob, account_email, password_cipher, password_set_at, password_viewed_at, tasks:onboarding_tasks(id, title, position, done_at, assignee_ids, notified_at, notified_by_name)";

type TaskRow = { id: string; title: string; position: number; done_at: string | null; assignee_ids: string[] | null; notified_at: string | null; notified_by_name: string | null };
type Row = Record<string, unknown> & { password_cipher: string | null; tasks: TaskRow[] | null };

// The cipher never leaves the server; callers only learn whether one is
// waiting. People who are only on a checklist item get the name, hire date
// and checklist: no date of birth, no login.
function toRequest(row: Row, role: OnboardingRole, names: Map<string, string>): OnboardingRequest {
  const tasks = [...(row.tasks ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((t) => ({
      id: t.id,
      title: t.title,
      done_at: t.done_at,
      assignees: (t.assignee_ids ?? []).map((id) => ({ id, name: names.get(id) ?? "Unknown user" })),
      notified_at: t.notified_at,
      notified_by_name: t.notified_by_name,
    }));
  const full = role !== "assignee";
  return {
    id: row.id as string,
    created_at: row.created_at as string,
    expires_at: row.expires_at as string,
    created_by: row.created_by as string,
    created_by_name: (row.created_by_name as string) ?? null,
    first_name: row.first_name as string,
    last_name: row.last_name as string,
    hire_date: row.hire_date as string,
    dob: full ? (row.dob as string) : null,
    tasks,
    account_email: full ? ((row.account_email as string) ?? null) : null,
    closed: new Date(row.expires_at as string).getTime() <= Date.now(),
    password_status: !full ? "none" : row.password_cipher ? "saved" : row.password_set_at ? "gone" : "none",
    password_set_at: full ? ((row.password_set_at as string) ?? null) : null,
    password_viewed_at: full ? ((row.password_viewed_at as string) ?? null) : null,
    role,
  };
}

// Admins and managers: opening requests, the full view.
export async function requireOnboardingUser(): Promise<Session | NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseOnboarding(session.user.permRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return session;
}

// Anyone signed in: what they can see is decided per request (scopedRows),
// so someone put on a checklist item can open it and tick it.
export async function requireOnboardingViewer(): Promise<Session | NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return session;
}

// Requests with a checklist item this person is on.
export async function assignedRequestIds(profileId: string): Promise<string[]> {
  const { data, error } = await createAdminClient()
    .from("onboarding_tasks")
    .select("request_id")
    .contains("assignee_ids", [profileId]);
  if (error) throw new Error(error.message);
  return [...new Set((data || []).map((t) => t.request_id as string))];
}

function roleFor(session: Session, row: Row): OnboardingRole {
  if (isAdmin(session.user.permRole)) return "admin";
  // A manager who lost manager rights still sees their own requests only as
  // a checklist person would.
  if (row.created_by === session.user.profileId && canUseOnboarding(session.user.permRole)) return "requester";
  return "assignee";
}

async function namesFor(rows: Row[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap((r) => (r.tasks ?? []).flatMap((t) => t.assignee_ids ?? [])))];
  if (!ids.length) return new Map();
  const { data } = await createAdminClient().from("profiles").select("id, email, full_name").in("id", ids);
  return new Map((data || []).map((p) => [p.id as string, (p.full_name as string) || (p.email as string)]));
}

// Admins see every request; managers the ones they opened; anyone the ones
// with a checklist item they're on. Open and closed alike.
async function scopedRows(session: Session, id?: string): Promise<OnboardingRequest[]> {
  let q = createAdminClient().from("onboarding_requests").select(COLUMNS);
  if (id) q = q.eq("id", id);
  if (!isAdmin(session.user.permRole)) {
    const me = session.user.profileId;
    const assigned = await assignedRequestIds(me);
    const own = canUseOnboarding(session.user.permRole) ? [`created_by.eq.${me}`] : [];
    const filters = [...own, ...(assigned.length ? [`id.in.(${assigned.join(",")})`] : [])];
    if (!filters.length) return [];
    q = q.or(filters.join(","));
  }
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = data as unknown as Row[];
  const names = await namesFor(rows);
  return rows.map((r) => toRequest(r, roleFor(session, r), names));
}

export async function listRequests(session: Session): Promise<OnboardingRequest[]> {
  return scopedRows(session);
}

export async function getRequest(session: Session, id: string): Promise<OnboardingRequest | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await scopedRows(session, id))[0] ?? null;
}

// Stored as {uuid}-{safe name}; strip the uuid for display.
export async function listDocuments(id: string): Promise<OnboardingDoc[]> {
  const { data } = await createAdminClient().storage.from(ONBOARDING_BUCKET).list(id, { limit: 100 });
  return (data || [])
    .filter((o) => o.id) // folders have no id
    .map((o) => ({
      name: o.name,
      filename: o.name.replace(/^[0-9a-f-]{36}-/, ""),
      size: (o.metadata?.size as number) ?? 0,
    }));
}

export async function getDetail(session: Session, id: string): Promise<OnboardingDetail | null> {
  const req = await getRequest(session, id);
  if (!req) return null;
  return { ...req, documents: req.role === "assignee" ? [] : await listDocuments(id) };
}

// "Delete now": the request, its documents and every bell about it.
export async function purgeRequest(id: string): Promise<void> {
  const supabase = createAdminClient();
  const docs = await listDocuments(id);
  if (docs.length) {
    const { error } = await supabase.storage.from(ONBOARDING_BUCKET).remove(docs.map((d) => `${id}/${d.name}`));
    if (error) throw new Error(`documents: ${error.message}`);
  }
  await supabase.from("notifications").delete().eq("reference_type", REFERENCE_TYPE).eq("reference_id", id);
  const { error } = await supabase.from("onboarding_requests").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// Closed requests are read-only. Returns a 409 to send back, or null.
export function closedError(r: Pick<OnboardingRequest, "closed">): NextResponse | null {
  return r.closed ? NextResponse.json({ error: "This request is closed." }, { status: 409 }) : null;
}

// ---------- default checklist + who gets tagged (admins edit both) ----------

export async function getTemplate(): Promise<TemplateTask[]> {
  const { data, error } = await createAdminClient()
    .from("onboarding_template_tasks")
    .select("id, title, assignee_ids")
    .order("position")
    .order("created_at");
  if (error) throw new Error(error.message);
  const rows = (data || []) as { id: string; title: string; assignee_ids: string[] }[];
  const ids = [...new Set(rows.flatMap((t) => t.assignee_ids))];
  const { data: people } = ids.length
    ? await createAdminClient().from("profiles").select("id, email, full_name").in("id", ids)
    : { data: [] };
  const names = new Map((people || []).map((p) => [p.id as string, (p.full_name as string) || (p.email as string)]));
  return rows.map((t) => ({ ...t, assignees: t.assignee_ids.map((id) => ({ id, name: names.get(id) ?? "Unknown user" })) }));
}

// A new request gets its own copy, so later edits never change it.
export async function copyTemplateTo(requestId: string): Promise<void> {
  const template = await getTemplate();
  if (!template.length) return;
  const { error } = await createAdminClient()
    .from("onboarding_tasks")
    .insert(template.map((t, i) => ({ request_id: requestId, title: t.title, position: i, assignee_ids: t.assignee_ids })));
  if (error) throw new Error(error.message);
}

// After any change to the default checklist, every request that isn't
// finished (past 30 days with every item ticked) follows it:
// missing tasks are added, order matches, and tasks taken off the list are
// removed unless they were already ticked (those stay, at the end).
// Tasks match by title. Who's on an item comes from the default checklist:
// items not yet done follow it.
export async function syncOpenRequests(): Promise<void> {
  const supabase = createAdminClient();
  const template = await getTemplate();
  const { data: open, error } = await supabase
    .from("onboarding_requests")
    .select("id, expires_at, tasks:onboarding_tasks(id, title, position, done_at, assignee_ids, notified_at)");
  if (error) throw new Error(error.message);
  const now = Date.now();

  const key = (title: string) => title.trim().toLowerCase();
  const inserts: { request_id: string; title: string; position: number; assignee_ids: string[] }[] = [];
  const moves: { id: string; position: number }[] = [];
  const assigns: { id: string; assignee_ids: string[] }[] = [];
  const deletes: string[] = [];

  for (const req of open || []) {
    const tasks = [...((req.tasks as TaskRow[] | null) ?? [])].sort((a, b) => a.position - b.position);
    if (new Date(req.expires_at).getTime() <= now && tasks.every((x) => x.done_at)) continue;
    const used = new Set<string>();
    template.forEach((t, position) => {
      const match = tasks.find((x) => !used.has(x.id) && key(x.title) === key(t.title));
      if (!match) return inserts.push({ request_id: req.id, title: t.title, position, assignee_ids: t.assignee_ids });
      used.add(match.id);
      if (match.position !== position) moves.push({ id: match.id, position });
      const had = match.assignee_ids ?? [];
      const same = had.length === t.assignee_ids.length && had.every((id) => t.assignee_ids.includes(id));
      if (!match.done_at && !same) assigns.push({ id: match.id, assignee_ids: t.assignee_ids });
    });
    let extra = template.length;
    for (const x of tasks) {
      if (used.has(x.id)) continue;
      if (!x.done_at) {
        deletes.push(x.id);
        continue;
      }
      if (x.position !== extra) moves.push({ id: x.id, position: extra });
      extra++;
    }
  }

  if (inserts.length) {
    const { error: e } = await supabase.from("onboarding_tasks").insert(inserts);
    if (e) throw new Error(e.message);
  }
  if (deletes.length) {
    const { error: e } = await supabase.from("onboarding_tasks").delete().in("id", deletes);
    if (e) throw new Error(e.message);
  }
  const results = await Promise.all([
    ...moves.map((m) => supabase.from("onboarding_tasks").update({ position: m.position }).eq("id", m.id)),
    ...assigns.map((a) => supabase.from("onboarding_tasks").update({ assignee_ids: a.assignee_ids }).eq("id", a.id)),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}

export async function getTagIds(): Promise<string[]> {
  const { data } = await createAdminClient().from("onboarding_settings").select("tag_profile_ids").eq("id", 1).maybeSingle();
  return (data?.tag_profile_ids as string[] | null) ?? [];
}

const fullName = (r: Pick<OnboardingRequest, "first_name" | "last_name">) => `${r.first_name} ${r.last_name}`;

const LAUNCHER_URL = process.env.LAUNCHER_URL || "https://bbd-launcher.vercel.app";

interface Tagged {
  id: string;
  email: string;
  name: string | null;
}

// The people admins picked on /onboarding (Rex by default), still active.
async function taggedPeople(): Promise<Tagged[]> {
  const ids = await getTagIds();
  if (!ids.length) return [];
  const { data } = await createAdminClient()
    .from("profiles")
    .select("id, email, name:full_name, is_active")
    .in("id", ids);
  return (data || []).filter((p) => p.is_active !== false) as Tagged[];
}

// Posts to SLACK_ONBOARDING_CHANNEL (falling back to the offboarding
// channel) tagging the people, or DMs each of them when neither is set.
// Name and hire date only: Slack keeps messages, so the DOB and documents
// stay in the launcher. Returns why it failed, or null; "skipped" without
// SLACK_BOT_TOKEN.
async function postSlack(people: Tagged[], text: (tags: string) => string): Promise<string | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return "skipped";
  if (!people.length) return null;
  const ids = await Promise.all(people.map((p) => slackUserId(token, p.email)));
  const tags = people.map((p, i) => (ids[i] ? `<@${ids[i]}>` : `*${slackName(p.name || p.email)}*`)).join(" ");
  const post = (channel: string) =>
    slackApi("chat.postMessage", token, { channel, text: text(tags), unfurl_links: false, unfurl_media: false });
  const channel = process.env.SLACK_ONBOARDING_CHANNEL || process.env.SLACK_OFFBOARDING_CHANNEL;
  const results = channel
    ? [await post(channel)]
    : await Promise.all(ids.filter((id): id is string => !!id).map(post));
  const failed = results.find((res) => !res.ok);
  if (failed) console.error("[onboarding] slack post failed:", failed.error);
  return failed ? failed.error || "Slack error" : results.length ? null : "nobody on Slack";
}

const hireDay = (r: Pick<OnboardingRequest, "hire_date">) =>
  new Date(r.hire_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const checklistLink = (r: Pick<OnboardingRequest, "id">) => `<${LAUNCHER_URL}/onboarding/${r.id}|Open the checklist>`;

async function notifySlack(r: OnboardingRequest, people: Tagged[]): Promise<void> {
  await postSlack(
    people,
    (tags) =>
      `${tags} *${slackName(r.created_by_name || "A manager")}* has submitted a new hire: ` +
      `*${slackName(fullName(r))}*
Date of hire: ${hireDay(r)}
${checklistLink(r)}`,
  );
}

// "Notify on Slack" on one checklist item: tags its people in Slack, rings
// their bell (not the presser's) and stamps notified_at. Returns the Slack
// problem to show, or null when it went out.
export async function notifyTask(
  r: OnboardingRequest,
  taskId: string,
  actor: { profileId: string; name: string },
): Promise<{ error: string } | { slack: string | null }> {
  const task = r.tasks.find((t) => t.id === taskId);
  if (!task) return { error: "Not found" };
  if (!task.assignees.length) return { error: "Put someone on this item first." };
  const { data } = await createAdminClient()
    .from("profiles")
    .select("id, email, name:full_name, is_active")
    .in("id", task.assignees.map((a) => a.id));
  const people = (data || []).filter((p) => p.is_active !== false) as Tagged[];
  if (!people.length) return { error: "Nobody on this item is active." };

  const [slack] = await Promise.all([
    postSlack(
      people,
      (tags) =>
        `${tags} you're up for new hire *${slackName(fullName(r))}* (hired ${hireDay(r)}): *${slackName(task.title)}*
` +
        `${checklistLink(r)} and tick it when it's done. — ${slackName(actor.name)}`,
    ),
    createNotifications(
      people.map((p) => p.id).filter((id) => id !== actor.profileId),
      {
        type: "onboarding_task",
        title: `${task.title}: ${fullName(r)}`,
        body: `${actor.name} asked you to do this for a new hire.`,
        href: `/onboarding/${r.id}`,
        referenceType: REFERENCE_TYPE,
        referenceId: r.id,
      },
    ),
  ]);
  const { error } = await createAdminClient()
    .from("onboarding_tasks")
    .update({ notified_at: new Date().toISOString(), notified_by_name: actor.name })
    .eq("id", taskId)
    .eq("request_id", r.id);
  if (error) return { error: error.message };
  return { slack };
}

// New request → Slack tag + bell for the picked people (the bell skips
// whoever opened it). Nobody picked → bell every active admin, no Slack.
export async function notifyOpened(r: OnboardingRequest, openerId: string): Promise<void> {
  const people = await taggedPeople();
  let bellIds = people.map((p) => p.id);
  if (!bellIds.length) {
    const { data } = await createAdminClient().from("profiles").select("id, is_active").eq("role", "admin");
    bellIds = (data || []).filter((p) => p.is_active !== false).map((p) => p.id);
  }
  await Promise.all([
    createNotifications(
      bellIds.filter((id) => id !== openerId),
      {
        type: "onboarding_opened",
        title: `New hire to set up: ${fullName(r)}`,
        body: `${r.created_by_name || "A manager"} opened an onboarding request.`,
        href: `/onboarding/${r.id}`,
        referenceType: REFERENCE_TYPE,
        referenceId: r.id,
      },
    ),
    notifySlack(r, people).catch((e) => console.error("[onboarding] slack error:", e)),
  ]);
}

// Login entered → bell for the manager who asked.
export async function notifyLoginReady(r: OnboardingRequest, actorId: string): Promise<void> {
  if (r.created_by === actorId) return;
  await createNotifications([r.created_by], {
    type: "onboarding_ready",
    title: `Login ready for ${fullName(r)}`,
    body: "Open it to see the email and password. The password disappears once you view it.",
    href: `/onboarding/${r.id}`,
    referenceType: REFERENCE_TYPE,
    referenceId: r.id,
  });
}
