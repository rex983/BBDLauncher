import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleRetiredMail } from "@/lib/offboarding/retired-mail";

// Called by the Apps Script on retiredemployees@ for every new email.
// Server-to-server only: authenticated by the shared RETIRED_MAIL_SECRET.

const schema = z.object({
  message_id: z.string().min(1).max(200),
  from: z.string().max(500).default(""),
  subject: z.string().max(1000).default(""),
  preview: z.string().max(5000).default(""),
  recipients: z.array(z.string().max(2000)).max(20).default([]),
});

function authorized(req: NextRequest): boolean {
  const secret = process.env.RETIRED_MAIL_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  const result = await handleRetiredMail(parsed.data);
  return NextResponse.json({ ok: true, ...result });
}
