// Server-side onboarding helpers: the permission gate, scoped reads, and the
// purge that deletes a request with its documents and bell notifications.
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
  ONBOARDING_STEP_KEYS,
  type OnboardingDetail,
  type OnboardingDoc,
  type OnboardingRequest,
} from "./types";

export const ONBOARDING_BUCKET = "onboarding-docs";
const REFERENCE_TYPE = "onboarding_request";

const COLUMNS =
  "id, created_at, expires_at, created_by, created_by_name, first_name, last_name, hire_date, dob, laptop_at, gmail_at, strapi_at, launcher_at, account_email, password_cipher, password_set_at, password_viewed_at";

type Row = Record<string, unknown> & { password_cipher: string | null };

// The cipher never leaves the server; callers only learn whether one is waiting.
function toRequest(row: Row): OnboardingRequest {
  const steps = Object.fromEntries(ONBOARDING_STEP_KEYS.map((k) => [k, (row[`${k}_at`] as string) ?? null]));
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
    steps: steps as OnboardingRequest["steps"],
    account_email: (row.account_email as string) ?? null,
    password_status: row.password_cipher ? "waiting" : row.password_viewed_at ? "viewed" : "none",
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

// Admins see every request; managers only the ones they opened. Expired
// rows are hidden even if the purge cron hasn't run yet.
function scoped(session: Session) {
  let q = createAdminClient()
    .from("onboarding_requests")
    .select(COLUMNS)
    .gt("expires_at", new Date().toISOString());
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

// Deletes the request, its documents and every bell notification about it.
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

export async function purgeExpired(): Promise<number> {
  const { data, error } = await createAdminClient()
    .from("onboarding_requests")
    .select("id")
    .lte("expires_at", new Date().toISOString());
  if (error) throw new Error(error.message);
  for (const r of data || []) await purgeRequest(r.id);
  return data?.length ?? 0;
}

const fullName = (r: Pick<OnboardingRequest, "first_name" | "last_name">) => `${r.first_name} ${r.last_name}`;

// Slack tags only Rex, who sets the accounts up.
const SLACK_TAG_EMAIL = "rex@bigbuildingsdirect.com";
const LAUNCHER_URL = process.env.LAUNCHER_URL || "https://bbd-launcher.vercel.app";

// Posts to SLACK_ONBOARDING_CHANNEL (falling back to the offboarding
// channel), or DMs Rex when neither is set. Name and hire date only: Slack
// keeps messages, so the DOB and documents stay in the launcher, where they
// expire. Best-effort and skipped without SLACK_BOT_TOKEN.
async function notifySlack(r: OnboardingRequest): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  const rexId = await slackUserId(token, SLACK_TAG_EMAIL);
  const channel = process.env.SLACK_ONBOARDING_CHANNEL || process.env.SLACK_OFFBOARDING_CHANNEL || rexId;
  if (!channel) return;
  const hire = new Date(r.hire_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const text =
    `${rexId ? `<@${rexId}>` : "*Rex*"} *${slackName(r.created_by_name || "A manager")}* has submitted a new hire: ` +
    `*${slackName(fullName(r))}*\nDate of hire: ${hire}\n<${LAUNCHER_URL}/onboarding/${r.id}|Open the checklist>`;
  const res = await slackApi("chat.postMessage", token, { channel, text, unfurl_links: false, unfurl_media: false });
  if (!res.ok) console.error("[onboarding] slack post failed:", res.error);
}

// New request → bell for every active admin except whoever opened it, and
// a Slack message tagging Rex.
export async function notifyOpened(r: OnboardingRequest, openerId: string): Promise<void> {
  const { data } = await createAdminClient().from("profiles").select("id, is_active").eq("role", "admin");
  const ids = (data || []).filter((p) => p.is_active !== false && p.id !== openerId).map((p) => p.id);
  await Promise.all([
    createNotifications(ids, {
      type: "onboarding_opened",
      title: `New hire to set up: ${fullName(r)}`,
      body: `${r.created_by_name || "A manager"} opened an onboarding request.`,
      href: `/onboarding/${r.id}`,
      referenceType: REFERENCE_TYPE,
      referenceId: r.id,
    }),
    notifySlack(r).catch((e) => console.error("[onboarding] slack error:", e)),
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
