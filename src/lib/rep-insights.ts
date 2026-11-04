import "server-only";

// Rep Insights, server to server: a rep's own goals and numbers, and their
// goal submission (Rep Insights /api/launcher/rep, which owns the numbers and
// the 1st–5th rule). The shared secret REP_INSIGHTS_API_SECRET is set in both
// projects; the rep is whoever is signed in here.

const BASE = (process.env.REP_INSIGHTS_URL || "https://bbd-rep-insights.vercel.app").replace(/\/$/, "");

export async function repInsights(profileId: string, init?: { goals: Record<string, unknown> }, date?: string): Promise<{ status: number; body: unknown }> {
  const secret = process.env.REP_INSIGHTS_API_SECRET;
  if (!secret) return { status: 503, body: { error: "Rep Insights isn't connected (REP_INSIGHTS_API_SECRET)." } };
  const url = `${BASE}/api/launcher/rep${init ? "" : `?profile=${encodeURIComponent(profileId)}${date ? `&date=${date}` : ""}`}`;
  try {
    const res = await fetch(url, {
      method: init ? "POST" : "GET",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: init ? JSON.stringify({ profile: profileId, goals: init.goals }) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    return { status: res.status, body: await res.json().catch(() => ({ error: `Rep Insights answered ${res.status}` })) };
  } catch {
    return { status: 502, body: { error: "Rep Insights didn't answer." } };
  }
}

/**
 * The team report (teams they lead) and office report (when they manage) for
 * this person: Rep Insights works out the teams; their role, office and
 * department come from here.
 */
export async function groupReports(
  who: { profileId: string; permRole: string | null; office: string | null; department: string | null },
  date?: string,
): Promise<{ status: number; body: unknown }> {
  const secret = process.env.REP_INSIGHTS_API_SECRET;
  if (!secret) return { status: 503, body: { error: "Rep Insights isn't connected (REP_INSIGHTS_API_SECRET)." } };
  const q = new URLSearchParams({ profile: who.profileId, perm: who.permRole ?? "", office: who.office ?? "", department: who.department ?? "" });
  if (date) q.set("date", date);
  try {
    const res = await fetch(`${BASE}/api/launcher/group?${q}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    return { status: res.status, body: await res.json().catch(() => ({ error: `Rep Insights answered ${res.status}` })) };
  } catch {
    return { status: 502, body: { error: "Rep Insights didn't answer." } };
  }
}
