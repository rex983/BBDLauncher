import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listMemosForEmployee } from "@/lib/memos/queries";
import { MemoPanel } from "@/components/features/memos/MemoPanel";

// Dedicated inbox route for the viewer's memos. Everyone gets this —
// employees and managers alike can be recipients — so it's linked from
// the top-level sidebar. The profile page still embeds MemoPanel at
// #memos for the "everything about me on one page" flow.
export default async function MemosInboxPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const supabase = createAdminClient();
  const rows = await listMemosForEmployee({
    supabase,
    profileId: session.user.profileId,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">My Memos</h1>
        <p className="text-muted-foreground mt-1">
          Every memo delivered to you. Acknowledge any that require it; the
          rest are here for reference.
        </p>
      </div>
      <MemoPanel
        initialRows={rows}
        title="Inbox"
        description="Click a row to open the memo. Acknowledged memos stay in this list for your records."
      />
    </div>
  );
}
