// Shared request-header helpers. Every audit-log / signature endpoint needs
// the same IP + UA extraction, so keeping it in one place ensures identical
// evidentiary metadata across incidents, memos, and any future feature that
// records who-did-what.

import type { NextRequest } from "next/server";

export function extractActorHeaders(req: NextRequest): {
  ip: string | null;
  ua: string | null;
} {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent")?.slice(0, 512) || null;
  return { ip, ua };
}
