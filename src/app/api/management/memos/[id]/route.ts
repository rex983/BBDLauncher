import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canEditTimeData,
  canViewTimeData,
  isAdmin,
} from "@/lib/auth/permissions";
import { logMemoEvent } from "@/lib/memos/audit";
import { extractActorHeaders } from "@/lib/http";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// GET /api/management/memos/[id] — full memo detail with recipient roster
// and audit events. Manager-tier scoped: authors + admins see any status;
// non-authors only see published memos targeted at their scope.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user || !canViewTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();
  const admin = isAdmin(session.user.role);

  const { data: memo, error } = await supabase
    .from("office_memos")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !memo) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Scope: authors + admins always see. Non-authors see only if the memo
  // is published AND their scope overlaps the audience.
  const isAuthor = memo.author_profile_id === session.user.profileId;
  if (!admin && !isAuthor) {
    if (memo.status !== "published") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const overlaps =
      memo.audience_scope === "company" ||
      (memo.audience_scope === "office" &&
        memo.audience_office === session.user.office) ||
      (memo.audience_scope === "department" &&
        memo.audience_department === session.user.department);
    if (!overlaps) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const [recipRes, eventsRes, authorRes] = await Promise.all([
    supabase
      .from("office_memo_recipients")
      .select(
        "id, profile_id, delivered_at, read_at, acknowledged_at, signature_text",
      )
      .eq("memo_id", id)
      .order("delivered_at", { ascending: true }),
    supabase
      .from("office_memo_events")
      .select("id, event_type, actor_profile_id, actor_ip, details, created_at")
      .eq("memo_id", id)
      .order("created_at", { ascending: true }),
    memo.author_profile_id
      ? supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("id", memo.author_profile_id)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  const profileIds = new Set<string>();
  for (const r of recipRes.data || []) profileIds.add(r.profile_id);
  for (const e of eventsRes.data || []) {
    if (e.actor_profile_id) profileIds.add(e.actor_profile_id);
  }
  const nameMap = new Map<string, string>();
  if (profileIds.size > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", Array.from(profileIds));
    for (const p of profs || []) {
      nameMap.set(p.id, p.full_name || p.email || p.id);
    }
  }

  const recipients = (recipRes.data || []).map((r) => ({
    ...r,
    name: nameMap.get(r.profile_id) || null,
  }));
  const events = (eventsRes.data || []).map((e) => ({
    ...e,
    actor_name: e.actor_profile_id ? nameMap.get(e.actor_profile_id) || null : null,
  }));

  return NextResponse.json({
    ...memo,
    author: authorRes.data
      ? { id: authorRes.data.id, name: authorRes.data.full_name, email: authorRes.data.email }
      : null,
    recipients,
    events,
    stats: {
      delivered: recipients.length,
      read: recipients.filter((r) => r.read_at).length,
      acknowledged: recipients.filter((r) => r.acknowledged_at).length,
    },
  });
}

// PATCH /api/management/memos/[id] — edit a memo. Edit-without-void:
// updating a published memo increments edit_count and logs an audit
// event, but does NOT clear recipient acks. Original document_hash and
// author signature stay valid against the *original* body — the edit
// event captures the delta.
const patchSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  body: z.string().min(3).max(50_000).optional(),
  category: z
    .enum(["policy", "procedure", "safety", "benefits", "announcement", "other"])
    .optional(),
  priority: z.enum(["informational", "important", "mandatory"]).optional(),
  effective_date: z.string().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user || !canEditTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const admin = isAdmin(session.user.role);

  const { data: existing } = await supabase
    .from("office_memos")
    .select("id, author_profile_id, status, edit_count, title, body, category, priority, effective_date")
    .eq("id", id)
    .single();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAuthor = existing.author_profile_id === session.user.profileId;
  if (!admin && !isAuthor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (existing.status === "archived") {
    return NextResponse.json({ error: "Cannot edit archived memo" }, { status: 400 });
  }

  const changes: { field: string; from: unknown; to: unknown }[] = [];
  const update: Record<string, unknown> = {};
  const fields = ["title", "body", "category", "priority", "effective_date"] as const;
  for (const f of fields) {
    if (parsed.data[f] !== undefined && parsed.data[f] !== existing[f]) {
      changes.push({ field: f, from: existing[f], to: parsed.data[f] });
      update[f] = parsed.data[f];
    }
  }
  if (changes.length === 0) {
    return NextResponse.json(existing);
  }

  if (existing.status === "published") {
    update.edit_count = (existing.edit_count || 0) + 1;
    update.last_editor_profile_id = session.user.profileId;
    update.last_edited_at = new Date().toISOString();
  }

  const { data: updated, error: updateErr } = await supabase
    .from("office_memos")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const { ip, ua } = extractActorHeaders(req);
  logMemoEvent({
    memoId: id,
    eventType: "edited",
    actorProfileId: session.user.profileId,
    actorIp: ip,
    actorUa: ua,
    details: {
      changes,
      status_at_edit: existing.status,
      note:
        existing.status === "published"
          ? "Post-publish edit — acknowledgements retained per policy."
          : "Draft edit.",
    },
  }).catch(() => undefined);

  return NextResponse.json(updated);
}

// DELETE /api/management/memos/[id] — archive (soft delete). Author +
// admins only. Doesn't hard-delete because recipient ack rows are audit
// evidence.
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user || !canEditTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const supabase = createAdminClient();
  const admin = isAdmin(session.user.role);

  const { data: existing } = await supabase
    .from("office_memos")
    .select("id, author_profile_id, status")
    .eq("id", id)
    .single();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!admin && existing.author_profile_id !== session.user.profileId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("office_memos")
    .update({
      status: "archived",
      archived_at: now,
      archived_by: session.user.profileId,
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { ip, ua } = extractActorHeaders(req);
  logMemoEvent({
    memoId: id,
    eventType: "archived",
    actorProfileId: session.user.profileId,
    actorIp: ip,
    actorUa: ua,
    details: { prior_status: existing.status },
  }).catch(() => undefined);

  return NextResponse.json({ ok: true });
}
