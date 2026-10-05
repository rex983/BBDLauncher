// Slack Web API calls made as the launcher's bot (SLACK_BOT_TOKEN, scopes
// chat:write + users:read.email). Unlike the webhook helpers in notify.ts,
// the bot can post anywhere it's invited and @-mention people by email.

export async function slackApi(method: string, token: string, body: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return (await res.json()) as { ok: boolean; error?: string; user?: { id: string } };
}

export async function slackUserId(token: string, email: string): Promise<string | null> {
  const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as { ok: boolean; user?: { id: string } };
  return json.ok && json.user ? json.user.id : null;
}

// "<@U123>" when Slack knows the email, else the name in bold.
export async function slackTags(
  token: string,
  people: { email: string; name: string | null }[],
  escapeName: (s: string) => string,
): Promise<string[]> {
  return Promise.all(
    people.map(async (p) => {
      const id = await slackUserId(token, p.email);
      return id ? `<@${id}>` : `*${escapeName(p.name || p.email)}*`;
    }),
  );
}
