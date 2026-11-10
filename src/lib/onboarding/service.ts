// Server-side onboarding helpers: the permission gate, scoped reads, closing
// requests after 7 days, and deleting one (with its documents and bells).
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
  type OnboardingTask,
  type TemplateTask,
} from "./types";

export const ONBOARDING_BUCKET = "onboarding-docs";
const REFERENCE_TYPE = "onboarding_request";

const COLUMNS =
  "id, created_at, expires_at, created_by, created_by_name, first_name, last_name, hire_date, dob, account_email, password_cipher, password_set_at, password_viewed_at, tasks:onboarding_tasks(id, title, position, done_at)";

type Row = Record<string, unknown> & { password_cipher: string | null };

// The cipher never leaves the server; callers only learn whether one is waiting.
function toRequest(row: Row): OnboardingRequest {
  const tasks = ((row.tasks as (OnboardingTask & { position: number })[]) ?? [])
    .sort((a, b) => a.position - b.position)
    .map(({ id, title, done_at }) => ({ id, title, done_at }));
  return {
    id: row.id as string,
    created_at: row.created_at as string,
    expires_at: row.expires_at as string,
    created_by: row.created_by as string,
    created_by_name: (row.created_by_name as string) ?? null,
    first_name: row.first_name as string,
    last_name: row.last_name as string,
    hire_date: row.hire_date as string,
    dob: row.dob as string,
    tasks,
    account_email: (row.account_email as string) ?? null,
    closed: new Date(row.expires_at as string).getTime() <= Date.now(),
    password_status: row.password_cipher
      ? "waiting"
      : row.password_viewed_at
        ? "viewed"
        : row.password_set_at
          ? "expired"
          : "none",
    password_set_at: (row.password_set_at as string) ?? null,
    password_viewed_at: (row.password_viewed_at as string) ?? null,
  };
}

export async function requireOnboardingUser(): Promise<Session | NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseOnboarding(session.user.permRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return session;
}

// Admins see every request; managers only the ones they opened. Open and
// closed alike: closed ones are kept for reference.
function scoped(session: Session) {
  let q = createAdminClient()
    .from("onboarding_requests")
    .select(COLUMNS);
  if (!isAdmin(session.user.permRole)) q = q.eq("created_by", session.user.profileId);
  return q;
}

export async function listRequests(session: Session): Promise<OnboardingRequest[]> {
  const { data, error } = await scoped(session).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as Row[]).map(toRequest);
}

export async function getRequest(session: Session, id: string): Promise<OnboardingRequest | null> {
  const { data } = await scoped(session).eq("id", id).maybeSingle();
  return data ? toRequest(data as unknown as Row) : null;
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
  return { ...req, documents: await listDocuments(id) };
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

// Requests close on their own 7 days after they were opened (reads compare
// expires_at, so this needs no status flip). The one thing not kept is a
// password nobody viewed: the hourly cron wipes it once the request closes.
export async function wipeClosedPasswords(): Promise<number> {
  const { data, error } = await createAdminClient()
    .from("onboarding_requests")
    .update({ password_cipher: null })
    .lte("expires_at", new Date().toISOString())
    .not("password_cipher", "is", null)
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

// Closed requests are read-only. Returns a 409 to send back, or null.
export function closedError(r: Pick<OnboardingRequest, "closed">): NextResponse | null {
  return r.closed ? NextResponse.json({ error: "This request is closed." }, { status: 409 }) : null;
}

// ---------- default checklist + who gets tagged (admins edit both) ----------

export async function getTemplate(): Promise<TemplateTask[]> {
  const { data, error } = await createAdminClient()
    .from("onboarding_template_tasks")
    .select("id, title")
    .order("position")
    .order("created_at");
  if (error) throw new Error(error.message);
  return data || [];
}

// A new request gets its own copy, so later edits never change it.
export async function copyTemplateTo(requestId: string): Promise<void> {
  const template = await getTemplate();
  if (!template.length) return;
  const { error } = await createAdminClient()
    .from("onboarding_tasks")
    .insert(template.map((t, i) => ({ request_id: requestId, title: t.title, position: i })));
  if (error) throw new Error(error.message);
}

// After any change to the default checklist, every open request follows it:
// missing tasks are added, order matches, and tasks taken off the list are
// removed unless they were already ticked (those stay, at the end).
// Tasks match by title.
export async function syncOpenRequests(): Promise<void> {
  const supabase = createAdminClient();
  const template = await getTemplate();
  const { data: open, error } = await supabase
    .from("onboarding_requests")
    .select("id, tasks:onboarding_tasks(id, title, position, done_at)")
    .gt("expires_at", new Date().toISOString());
  if (error) throw new Error(error.message);

  const key = (title: string) => title.trim().toLowerCase();
  const inserts: { request_id: string; title: string; position: number }[] = [];
  const moves: { id: string; position: number }[] = [];
  const deletes: string[] = [];

  for (const req of open || []) {
    const tasks = [...((req.tasks as (OnboardingTask & { position: number })[]) ?? [])].sort((a, b) => a.position - b.position);
    const used = new Set<string>();
    template.forEach((t, position) => {
      const match = tasks.find((x) => !used.has(x.id) && key(x.title) === key(t.title));
      if (!match) return inserts.push({ request_id: req.id, title: t.title, position });
      used.add(match.id);
      if (match.position !== position) moves.push({ id: match.id, position });
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
  const results = await Promise.all(
    moves.map((m) => supabase.from("onboarding_tasks").update({ position: m.position }).eq("id", m.id)),
  );
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
// channel) tagging the picked people, or DMs each of them when neither is
// set. Name and hire date only: Slack keeps messages, so the DOB and
// documents stay in the launcher, where they expire. Best-effort and
// skipped without SLACK_BOT_TOKEN.
async function notifySlack(r: OnboardingRequest, people: Tagged[]): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || !people.length) return;
  const ids = await Promise.all(people.map((p) => slackUserId(token, p.email)));
  const tags = people.map((p, i) => (ids[i] ? `<@${ids[i]}>` : `*${slackName(p.name || p.email)}*`)).join(" ");
  const hire = new Date(r.hire_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const text =
    `${tags} *${slackName(r.created_by_name || "A manager")}* has submitted a new hire: ` +
    `*${slackName(fullName(r))}*\nDate of hire: ${hire}\n<${LAUNCHER_URL}/onboarding/${r.id}|Open the checklist>`;
  const post = (channel: string) =>
    slackApi("chat.postMessage", token, { channel, text, unfurl_links: false, unfurl_media: false });
  const channel = process.env.SLACK_ONBOARDING_CHANNEL || process.env.SLACK_OFFBOARDING_CHANNEL;
  const results = channel
    ? [await post(channel)]
    : await Promise.all(ids.filter((id): id is string => !!id).map(post));
  for (const res of results) if (!res.ok) console.error("[onboarding] slack post failed:", res.error);
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
