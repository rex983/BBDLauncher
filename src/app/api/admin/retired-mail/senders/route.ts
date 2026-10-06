import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { isAdmin } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

// "Always alert" / "never alert" rules for a sender address or @domain.
const pattern = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^([a-z0-9._%+'-]+)?@[a-z0-9.-]+\.[a-z]{2,}$/, "Use an email address or @domain.com");

const upsertSchema = z.object({ pattern, action: z.enum(["allow", "block"]) });

export async function POST(req: NextRequest) {
  const session = await requireSession(isAdmin);
  if (session instanceof NextResponse) return session;
  const parsed = upsertSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad request" }, { status: 400 });
  }
  const { error } = await createAdminClient()
    .from("retired_mail_senders")
    .upsert({ ...parsed.data, created_by: session.user.id, created_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await requireSession(isAdmin);
  if (session instanceof NextResponse) return session;
  const parsed = pattern.safeParse(req.nextUrl.searchParams.get("pattern") ?? "");
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { error } = await createAdminClient().from("retired_mail_senders").delete().eq("pattern", parsed.data);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
