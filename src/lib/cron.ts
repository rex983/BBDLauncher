import { NextResponse, type NextRequest } from "next/server";

// Require CRON_SECRET to be set — never fall back to trusting the
// x-vercel-cron header on its own, since a missing secret would leave the
// route completely open in dev / misconfigured environments. Vercel's
// scheduled invocations send that header instead of the Bearer.
function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return req.headers.get("x-vercel-cron") === "1";
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
