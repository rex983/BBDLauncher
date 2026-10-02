import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logMemoEvent } from "@/lib/memos/audit";
import type {
  MemoAcknowledgementMode,
  MemoAttachment,
  MemoCategory,
  MemoPriority,
} from "@/lib/memos/types";
import { EmployeeMemoView } from "./EmployeeMemoView";

export interface EmployeeMemoPageData {
  id: string;
  number: number | null;
  title: string;
  body: string;
  category: MemoCategory;
  priority: MemoPriority;
  acknowledgement_mode: MemoAcknowledgementMode;
  effective_date: string | null;
  published_at: string | null;
  attachments: MemoAttachment[] | null;
  author_name: string | null;
  document_hash: string | null;
  author_signature_hash: string | null;
  edit_count: number;
  last_edited_at: string | null;
  recipient: {
    id: string;
    delivered_at: string;
    read_at: string | null;
    acknowledged_at: string | null;
    signature_text: string | null;
  };
}

// Full-page employee memo view. Replaces the modal dialog — memos are
// often long-form, so a real page (with printable layout + shareable
// URL) fits the content better. Deep-linked from the bell notification
// href set in publishMemo.
export default async function EmployeeMemoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect("/login");

  const supabase = createAdminClient();

  const [{ data: recipient }, { data: memo }, { data: profile }] = await Promise.all([
    supabase
      .from("office_memo_recipients")
      .select("id, delivered_at, read_at, acknowledged_at, signature_text")
      .eq("memo_id", id)
      .eq("profile_id", session.user.profileId)
      .single(),
    supabase
      .from("office_memos")
      .select(
        "id, number, title, body, category, priority, acknowledgement_mode, effective_date, published_at, attachments, author_profile_id, document_hash, author_signature_hash, edit_count, last_edited_at",
      )
      .eq("id", id)
      .eq("status", "published")
      .single(),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", session.user.profileId)
      .single(),
  ]);
  // Only recipients of a published memo can open it.
  if (!recipient || !memo) notFound();

  // Stamp read_at on first view (in parallel with the author lookup).
  // Informational memos skip this — no receipt required for those.
  const stampRead = async () => {
    if (recipient.read_at || memo.acknowledgement_mode === "informational") return;
    const now = new Date().toISOString();
    await supabase
      .from("office_memo_recipients")
      .update({ read_at: now })
      .eq("id", recipient.id);
    logMemoEvent({
      memoId: id,
      eventType: "recipient_read",
      actorProfileId: session.user.profileId,
      actorIp: null,
      actorUa: "page-view",
    }).catch(() => undefined);
    recipient.read_at = now;
  };

  const [{ data: author }] = await Promise.all([
    memo.author_profile_id
      ? supabase
          .from("profiles")
          .select("full_name")
          .eq("id", memo.author_profile_id)
          .single()
      : Promise.resolve({ data: null }),
    stampRead(),
  ]);

  const data: EmployeeMemoPageData = {
    ...memo,
    author_name: author?.full_name ?? null,
    recipient,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="text-sm text-muted-foreground print:hidden">
        <Link href="/memos" className="hover:underline">
          ← Back to my memos
        </Link>
      </div>
      <EmployeeMemoView data={data} employeeFullName={profile?.full_name ?? null} />
    </div>
  );
}
