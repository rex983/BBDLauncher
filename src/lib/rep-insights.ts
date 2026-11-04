import "server-only";

// Rep Insights, server to server: a rep's own goals and numbers, and their
// goal submission (Rep Insights /api/launcher/rep, which owns the numbers and
// the 1st–5th rule). The shared secret REP_INSIGHTS_API_SECRET is set in both
// projects; the rep is whoever is signed in here.

const BASE = (process.env.REP_INSIGHTS_URL || "https://bbd-rep-insights.vercel.app").replace(/\/$/, "");

export async function repInsights(profileId: string, init?: { goals: Record<string, unknown> }): Promise<{ status: number; body: unknown }> {
  const secret = process.env.REP_INSIGHTS_API_SECRET;
  if (!secret) return { status: 503, body: { error: "Rep Insights isn't connected (REP_INSIGHTS_API_SECRET)." } };
  const url = `${BASE}/api/launcher/rep${init ? "" : `?profile=${encodeURIComponent(profileId)}`}`;
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
