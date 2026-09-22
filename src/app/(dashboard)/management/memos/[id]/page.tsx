import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData, isAdmin } from "@/lib/auth/permissions";
import type { MemoEventType } from "@/lib/memos/audit";
import type {
  MemoAcknowledgementMode,
  MemoAttachment,
  MemoAudienceScope,
  MemoCategory,
  MemoPriority,
  MemoStatus,
} from "@/lib/memos/types";
import { ManagerMemoView } from "./ManagerMemoView";

export interface ManagerMemoPageData {
  id: string;
  number: number | null;
  title: string;
  body: string;
  category: MemoCategory;
  priority: MemoPriority;
  acknowledgement_mode: MemoAcknowledgementMode;
  audience_scope: MemoAudienceScope;
  audience_office: string | null;
  audience_department: string | null;
  effective_date: string | null;
  published_at: string | null;
  status: MemoStatus;
  attachments: MemoAttachment[] | null;
  edit_count: number;
  last_edited_at: string | null;
  document_hash: string | null;
  author_signature_text: string | null;
  author_signature_hash: string | null;
  author_signed_at: string | null;
  author: { id: string; name: string | null; email: string | null } | null;
  recipients: {
    id: string;
    profile_id: string;
    delivered_at: string;
    read_at: string | null;
    acknowledged_at: string | null;
    signature_text: string | null;
    name: string | null;
  }[];
  events: {
    id: string;
    event_type: MemoEventType | string;
    actor_profile_id: string | null;
    details: Record<string, unknown> | null;
    created_at: string;
    actor_name: string | null;
  }[];
  stats: { delivered: number; read: number; acknowledged: number };
}

interface ProfileSlice {
  id: string;
  full_name: string | null;
  email: string | null;
}

// Full-page manager view: memo body + recipient roster + audit timeline
// + edit/publish/archive controls. Replaces the modal dialog so memos —
// which can carry a lot of body text + a long recipient list — have room
// to breathe. Same visibility rules as GET /api/management/memos/[id].
export default async function ManagerMemoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canViewTimeData(session.user.role)) redirect("/dashboard");

  const supabase = createAdminClient();
  const { data: memo } = await supabase
    .from("office_memos")
    .select("*")
    .eq("id", id)
    .single();
  if (!memo) notFound();

  // Scope: author + admin always see; other manager-tier only see if
  // published AND their scope overlaps the audience.
  const admin = isAdmin(session.user.role);
  const isAuthor = memo.author_profile_id === session.user.profileId;
  if (!admin && !isAuthor) {
    if (memo.status !== "published") notFound();
    const overlaps =
      memo.audience_scope === "company" ||
      (memo.audience_scope === "office" &&
        memo.audience_office === session.user.office) ||
      (memo.audience_scope === "department" &&
        memo.audience_department === session.user.department);
    if (!overlaps) notFound();
  }

  const [recipRes, eventsRes, authorRes] = await Promise.all([
    supabase
      .from("office_memo_recipients")
      .select("id, profile_id, delivered_at, read_at, acknowledged_at, signature_text")
      .eq("memo_id", id)
      .order("delivered_at", { ascending: true }),
    supabase
      .from("office_memo_events")
      .select("id, event_type, actor_profile_id, details, created_at")
      .eq("memo_id", id)
      .order("created_at", { ascending: true }),
    memo.author_profile_id
      ? supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("id", memo.author_profile_id)
          .single<ProfileSlice>()
      : Promise.resolve({ data: null as ProfileSlice | null }),
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

  const data: ManagerMemoPageData = {
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
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="text-sm text-muted-foreground print:hidden">
        <Link href="/management/memos" className="hover:underline">
          ← Back to memos
        </Link>
      </div>
      <ManagerMemoView
        data={data}
        viewerProfileId={session.user.profileId}
        viewerIsAdmin={admin}
      />
    </div>
  );
}
