import { NextResponse, type NextRequest } from "next/server";

// Only the Bearer CRON_SECRET is trusted. Vercel's scheduled invocations
// send it automatically when the env var is set, and the GitHub
// auto-clockout workflow sends it explicitly. The x-vercel-cron header is
// NOT accepted — any client can set it. A missing secret rejects everything.
function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Wrap a cron handler with the auth check. Use as
// `export const { GET, POST } = cronRoute(handle);`
export function cronRoute(handler: (req: NextRequest) => Promise<Response>) {
  const route = async (req: NextRequest) => {
    if (!isCronAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(req);
  };
  return { GET: route, POST: route };
}
