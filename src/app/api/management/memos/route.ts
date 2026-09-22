import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canEditTimeData,
  canViewTimeData,
  isAdmin,
} from "@/lib/auth/permissions";
import { logMemoEvent } from "@/lib/memos/audit";
import { hashAuthorSignature, hashMemoDocument } from "@/lib/memos/hashing";
import { publishMemo } from "@/lib/memos/service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const VALID_OFFICES = new Set(["Harbor", "Marion", "BST", "RnD"]);
const VALID_DEPARTMENTS = new Set(["SALES TEAM", "BST", "RnD"]);

const attachmentSchema = z.object({
  path: z.string().min(1),
  filename: z.string().min(1),
  size: z.number().nonnegative(),
  mime: z.string().min(1),
});

const createSchema = z.object({
  title: z.string().min(3).max(200),
  body: z.string().min(3).max(50_000),
  category: z.enum([
    "policy",
    "procedure",
    "safety",
    "benefits",
    "announcement",
    "other",
  ]),
  priority: z.enum(["informational", "important", "mandatory"]),
  acknowledgement_mode: z.enum(["informational", "read_receipt", "signed"]),
  audience_scope: z.enum(["company", "office", "department", "custom"]),
  audience_office: z.string().nullable().optional(),
  audience_department: z.string().nullable().optional(),
  custom_profile_ids: z.array(z.string().uuid()).max(500).optional(),
  effective_date: z.string().nullable().optional(),
  publish_immediately: z.boolean().default(true),
  attachments: z.array(attachmentSchema).max(20).default([]),
});

// GET /api/management/memos — list memos the viewer can see.
//   admin              → all memos
//   manager-tier       → memos they authored + memos published to their
//                        office/department (so they know what their team
//                        has been asked to acknowledge)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !canViewTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const statuses = statusParam
    ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
    : ["draft", "published", "archived"];

  const supabase = createAdminClient();
  const admin = isAdmin(session.user.role);

  let query = supabase
    .from("office_memos")
    .select(
      "id, number, author_profile_id, title, category, priority, acknowledgement_mode, audience_scope, audience_office, audience_department, status, effective_date, published_at, created_at, updated_at",
    )
    .in("status", statuses)
    .order("created_at", { ascending: false });

  if (!admin) {
    // Manager sees: memos they authored OR published memos whose audience
    // covers their office/department. Drafts stay private to their author
    // (only admins see everyone's).
    const orParts: string[] = [`author_profile_id.eq.${session.user.profileId}`];
    if (session.user.office) {
      orParts.push(
        `and(status.eq.published,audience_scope.eq.office,audience_office.eq.${session.user.office})`,
      );
      orParts.push(`and(status.eq.published,audience_scope.eq.company)`);
    }
    if (session.user.department) {
      orParts.push(
        `and(status.eq.published,audience_scope.eq.department,audience_department.eq.${session.user.department})`,
      );
    }
    query = query.or(orParts.join(","));
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach recipient stats (delivered / read / acknowledged) so the list
  // view can show progress badges. One roundtrip using a single aggregate.
  const memoIds = (data || []).map((m) => m.id);
  const statsByMemo = new Map<
    string,
    { delivered: number; read: number; acknowledged: number }
  >();
  if (memoIds.length > 0) {
    const { data: recips } = await supabase
      .from("office_memo_recipients")
      .select("memo_id, read_at, acknowledged_at")
      .in("memo_id", memoIds);
    for (const row of recips || []) {
      const s = statsByMemo.get(row.memo_id) || {
        delivered: 0,
        read: 0,
        acknowledged: 0,
      };
      s.delivered += 1;
      if (row.read_at) s.read += 1;
      if (row.acknowledged_at) s.acknowledged += 1;
      statsByMemo.set(row.memo_id, s);
    }
  }

  // Also join author name for display.
  const authorIds = Array.from(
    new Set(
      (data || [])
        .map((m) => m.author_profile_id)
        .filter((id): id is string => !!id),
    ),
  );
  const authorMap = new Map<string, { id: string; full_name: string | null }>();
  if (authorIds.length > 0) {
    const { data: authors } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);
    for (const a of authors || []) authorMap.set(a.id, a);
  }

  return NextResponse.json(
    (data || []).map((m) => ({
      ...m,
      author_name: m.author_profile_id
        ? authorMap.get(m.author_profile_id)?.full_name || null
        : null,
      stats: statsByMemo.get(m.id) || {
        delivered: 0,
        read: 0,
        acknowledged: 0,
      },
    })),
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !canEditTimeData(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const admin = isAdmin(session.user.role);
  const supabase = createAdminClient();

  // Audience validation. Managers can target only their own office /
  // department; admins can target anything.
  if (parsed.data.audience_office && !VALID_OFFICES.has(parsed.data.audience_office)) {
    return NextResponse.json({ error: "Invalid audience_office" }, { status: 400 });
  }
  if (
    parsed.data.audience_department &&
    !VALID_DEPARTMENTS.has(parsed.data.audience_department)
  ) {
    return NextResponse.json({ error: "Invalid audience_department" }, { status: 400 });
  }
  if (!admin) {
    if (parsed.data.audience_scope === "company") {
      return NextResponse.json(
        { error: "Only admins can send company-wide memos" },
        { status: 403 },
      );
    }
    if (
      parsed.data.audience_scope === "office" &&
      parsed.data.audience_office !== session.user.office
    ) {
      return NextResponse.json(
        { error: "You can only send memos to your own office" },
        { status: 403 },
      );
    }
    if (
      parsed.data.audience_scope === "department" &&
      parsed.data.audience_department !== session.user.department
    ) {
      return NextResponse.json(
        { error: "You can only send memos to your own department" },
        { status: 403 },
      );
    }
  }

  // Attachment path guard — memo attachments live under the author's id
  // in the bucket so the download endpoint can enforce authorship.
  for (const a of parsed.data.attachments) {
    if (!a.path.startsWith(`${session.user.profileId}/`)) {
      return NextResponse.json({ error: "Invalid attachment path" }, { status: 400 });
    }
  }

  // Custom-audience memos must publish immediately because the recipient
  // list only exists in the request body — dropping to draft would lose
  // it. Draft with custom scope isn't supported in MVP.
  const now = new Date();
  const willPublishNow = parsed.data.publish_immediately;
  if (parsed.data.audience_scope === "custom" && !willPublishNow) {
    return NextResponse.json(
      { error: "Custom-audience memos must be published immediately." },
      { status: 400 },
    );
  }
  // Row lands as `draft` first — publishMemo handles the draft→published
  // transition when the manager clicks publish. No scheduling.
  const initialStatus = "draft" as const;

  // Signed-mode memos get hashed at creation time, locking the document
  // in place before it can go out. Manager clicking Publish later only
  // flips the status — no re-hashing.
  let documentHash: string | null = null;
  let authorSignatureText: string | null = null;
  let authorSignatureHash: string | null = null;
  let authorSignedAt: string | null = null;

  const isSigned = parsed.data.acknowledgement_mode === "signed";
  if (isSigned) {
    const { data: authorProfile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", session.user.profileId)
      .single<{ full_name: string | null }>();
    authorSignatureText = (authorProfile?.full_name || "").trim();
    if (!authorSignatureText) {
      return NextResponse.json(
        { error: "Missing your name on file — contact an admin before publishing." },
        { status: 400 },
      );
    }
    documentHash = hashMemoDocument(parsed.data.body);
    authorSignedAt = now.toISOString();
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    const ua = req.headers.get("user-agent")?.slice(0, 512) || null;
    authorSignatureHash = hashAuthorSignature({
      documentHash,
      signatureText: authorSignatureText,
      signedAt: authorSignedAt,
      ip,
      ua,
    });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ua = req.headers.get("user-agent")?.slice(0, 512) || null;

  const { data: memo, error: insertErr } = await supabase
    .from("office_memos")
    .insert({
      author_profile_id: session.user.profileId,
      title: parsed.data.title,
      body: parsed.data.body,
      category: parsed.data.category,
      priority: parsed.data.priority,
      acknowledgement_mode: parsed.data.acknowledgement_mode,
      audience_scope: parsed.data.audience_scope,
      audience_office: parsed.data.audience_office ?? null,
      audience_department: parsed.data.audience_department ?? null,
      effective_date: parsed.data.effective_date ?? null,
      attachments: parsed.data.attachments,
      status: initialStatus,
      document_hash: documentHash,
      author_signature_text: authorSignatureText,
      author_signature_hash: authorSignatureHash,
      author_signed_at: authorSignedAt,
      author_signature_ip: isSigned ? ip : null,
      author_signature_ua: isSigned ? ua : null,
    })
    .select()
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  logMemoEvent({
    memoId: memo.id,
    eventType: "draft_saved",
    actorProfileId: session.user.profileId,
    actorIp: ip,
    actorUa: ua,
    details: {
      title: memo.title,
      category: memo.category,
      priority: memo.priority,
      audience_scope: memo.audience_scope,
      audience_office: memo.audience_office,
      audience_department: memo.audience_department,
      acknowledgement_mode: memo.acknowledgement_mode,
      attachment_count: parsed.data.attachments.length,
    },
  }).catch(() => undefined);

  if (willPublishNow) {
    try {
      await publishMemo({
        supabase,
        memoId: memo.id,
        actorProfileId: session.user.profileId,
        actorIp: ip,
        actorUa: ua,
        customProfileIds: parsed.data.custom_profile_ids,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Publish failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  return NextResponse.json(memo, { status: 201 });
}
