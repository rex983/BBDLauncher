// Shared server-side loaders for memo pages + API routes. Collapses
// the previously-sequential 3-query pattern (memos → recipients →
// authors) into a single embedded-select query. Big win on hot paths:
// /management/memos (manager dashboard) and /api/memos (employee list).

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  MemoAcknowledgementMode,
  MemoAudienceScope,
  MemoCategory,
  MemoPriority,
  MemoStatus,
} from "@/lib/memos/types";

// ============================================================
// Management side — memos the viewer can see on /management/memos
// ============================================================

export interface ManagementMemoSummary {
  id: string;
  number: number | null;
  author_profile_id: string | null;
  author_name: string | null;
  title: string;
  category: MemoCategory;
  priority: MemoPriority;
  acknowledgement_mode: MemoAcknowledgementMode;
  audience_scope: MemoAudienceScope;
  audience_office: string | null;
  audience_department: string | null;
  status: MemoStatus;
  effective_date: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  stats: { delivered: number; read: number; acknowledged: number };
}

export interface ManagementListParams {
  supabase: SupabaseClient;
  viewer: {
    profileId: string;
    role: string;
    office: string | null;
    department: string | null;
  };
  statuses?: string[];
}

interface RawMemoRow {
  id: string;
  number: number | null;
  author_profile_id: string | null;
  title: string;
  category: MemoCategory;
  priority: MemoPriority;
  acknowledgement_mode: MemoAcknowledgementMode;
  audience_scope: MemoAudienceScope;
  audience_office: string | null;
  audience_department: string | null;
  status: MemoStatus;
  effective_date: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  author: { id: string; full_name: string | null } | null;
  recipients: {
    read_at: string | null;
    acknowledged_at: string | null;
  }[] | null;
}

export async function listMemosForManagement(
  params: ManagementListParams,
): Promise<ManagementMemoSummary[]> {
  const { supabase, viewer } = params;
  const statuses = params.statuses ?? ["draft", "published", "archived"];
  const admin = viewer.role === "admin";

  // One embedded-select query returns memos + author names + recipient
  // rows for stats in a single round-trip. Old code did 3 sequential
  // queries; the aggregate is folded in JS on the return path.
  let query = supabase
    .from("office_memos")
    .select(
      `id, number, author_profile_id, title, category, priority,
       acknowledgement_mode, audience_scope, audience_office,
       audience_department, status, effective_date, published_at,
       created_at, updated_at,
       author:profiles!author_profile_id(id, full_name),
       recipients:office_memo_recipients(read_at, acknowledged_at)`,
    )
    .in("status", statuses)
    .order("created_at", { ascending: false });

  if (!admin) {
    // Manager sees: memos they authored OR published memos whose audience
    // covers their office / department. Same OR expression the old
    // endpoint used.
    const orParts: string[] = [`author_profile_id.eq.${viewer.profileId}`];
    if (viewer.office) {
      orParts.push(
        `and(status.eq.published,audience_scope.eq.office,audience_office.eq.${viewer.office})`,
      );
      orParts.push(`and(status.eq.published,audience_scope.eq.company)`);
    }
    if (viewer.department) {
      orParts.push(
        `and(status.eq.published,audience_scope.eq.department,audience_department.eq.${viewer.department})`,
      );
    }
    query = query.or(orParts.join(","));
  }

  const { data } = await query.returns<RawMemoRow[]>();

  return (data || []).map((row) => {
    const recips = row.recipients ?? [];
    let read = 0;
    let acknowledged = 0;
    for (const r of recips) {
      if (r.read_at) read += 1;
      if (r.acknowledged_at) acknowledged += 1;
    }
    return {
      id: row.id,
      number: row.number,
      author_profile_id: row.author_profile_id,
      author_name: row.author?.full_name ?? null,
      title: row.title,
      category: row.category,
      priority: row.priority,
      acknowledgement_mode: row.acknowledgement_mode,
      audience_scope: row.audience_scope,
      audience_office: row.audience_office,
      audience_department: row.audience_department,
      status: row.status,
      effective_date: row.effective_date,
      published_at: row.published_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      stats: {
        delivered: recips.length,
        read,
        acknowledged,
      },
    };
  });
}

// ============================================================
// Employee side — memos delivered to this user (published only)
// ============================================================

export interface EmployeeMemoRow {
  recipient_id: string;
  memo_id: string;
  delivered_at: string;
  read_at: string | null;
  acknowledged_at: string | null;
  number: number | null;
  title: string;
  category: MemoCategory;
  priority: MemoPriority;
  acknowledgement_mode: MemoAcknowledgementMode;
  effective_date: string | null;
  published_at: string | null;
  author_name: string | null;
}

interface RawEmployeeRecipient {
  id: string;
  memo_id: string;
  delivered_at: string;
  read_at: string | null;
  acknowledged_at: string | null;
  memo:
    | {
        id: string;
        number: number | null;
        title: string;
        category: MemoCategory;
        priority: MemoPriority;
        acknowledgement_mode: MemoAcknowledgementMode;
        effective_date: string | null;
        published_at: string | null;
        status: string;
        author: { id: string; full_name: string | null } | null;
      }
    | null;
}

export async function listMemosForEmployee(params: {
  supabase: SupabaseClient;
  profileId: string;
}): Promise<EmployeeMemoRow[]> {
  const { supabase, profileId } = params;

  // Single query — recipient rows for this user, with memo + author
  // nested via foreign-table select. Filter to published memos on the
  // nested side so drafts/scheduled don't leak.
  const { data } = await supabase
    .from("office_memo_recipients")
    .select(
      `id, memo_id, delivered_at, read_at, acknowledged_at,
       memo:office_memos!inner(id, number, title, category, priority,
         acknowledgement_mode, effective_date, published_at, status,
         author:profiles!author_profile_id(id, full_name))`,
    )
    .eq("profile_id", profileId)
    .eq("memo.status", "published")
    .order("delivered_at", { ascending: false })
    .returns<RawEmployeeRecipient[]>();

  return (data || [])
    .filter((r): r is RawEmployeeRecipient & { memo: NonNullable<RawEmployeeRecipient["memo"]> } => r.memo !== null)
    .map((r) => ({
      recipient_id: r.id,
      memo_id: r.memo_id,
      delivered_at: r.delivered_at,
      read_at: r.read_at,
      acknowledged_at: r.acknowledged_at,
      number: r.memo.number,
      title: r.memo.title,
      category: r.memo.category,
      priority: r.memo.priority,
      acknowledgement_mode: r.memo.acknowledgement_mode,
      effective_date: r.memo.effective_date,
      published_at: r.memo.published_at,
      author_name: r.memo.author?.full_name ?? null,
    }));
}
