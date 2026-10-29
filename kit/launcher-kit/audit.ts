// Edit/audit log: tells the database who is making each write.
//
// Pass auditFetch(<app name>) as the service-role client's fetch:
//   createClient(url, key, { global: { fetch: auditFetch("My App") }, ... })
// (The name is passed in rather than read from config.ts, which imports the
// admin client: that would be an import cycle.)
// On every write (anything but GET/HEAD) it reads the signed-in person from
// the NextAuth cookie and sends them as `x-audit-actor`, plus `x-audit-app`.
// Triggers on the shared database (launcher migration 060) put that on each
// audit_log row. With no request or no session (cron, sync, scripts) nothing
// is added and the row is logged as "system".
//
// It reads the token directly instead of calling auth(), so it never re-runs
// the app's jwt callback (which itself writes to the database).

export interface AuditActor {
  id: string;
  email: string | null;
  name: string | null;
  /** The person whose view an admin was using ("View as"). */
  asId?: string;
  asEmail?: string | null;
}

type TokenLike = Record<string, unknown> & {
  profileId?: unknown;
  email?: unknown;
  name?: unknown;
  viewAs?: { actorProfileId?: string; actorEmail?: string; actorName?: string } | null;
};

/** The signed-in person for the current request, or null outside one. */
export async function currentAuditActor(): Promise<AuditActor | null> {
  let headerList: Headers;
  try {
    const { headers } = await import("next/headers");
    headerList = new Headers(await headers());
  } catch {
    return null; // not inside a request (script, build, background job)
  }
  const cookie = headerList.get("cookie") ?? "";
  if (!cookie.includes("authjs.session-token")) return null;
  try {
    const { getToken } = await import("next-auth/jwt");
    const token = (await getToken({
      req: { headers: headerList },
      secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
      secureCookie: cookie.includes("__Secure-authjs.session-token"),
    })) as TokenLike | null;
    if (!token || typeof token.profileId !== "string") return null;
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    const viewAs = token.viewAs && typeof token.viewAs.actorProfileId === "string" ? token.viewAs : null;
    if (viewAs) {
      // An admin viewing as someone: the admin made the change.
      return {
        id: viewAs.actorProfileId!,
        email: str(viewAs.actorEmail),
        name: str(viewAs.actorName),
        asId: token.profileId,
        asEmail: str(token.email),
      };
    }
    return { id: token.profileId, email: str(token.email), name: str(token.name) };
  } catch {
    return null;
  }
}

function encode(actor: AuditActor): string {
  return Buffer.from(JSON.stringify(actor), "utf8").toString("base64");
}

/** A fetch for supabase-js that tags writes with the acting person. */
export function auditFetch(app: string, base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method === "GET" || method === "HEAD") return base(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("x-audit-app", app);
    const actor = await currentAuditActor();
    if (actor) headers.set("x-audit-actor", encode(actor));
    return base(input, { ...init, headers });
  };
}
