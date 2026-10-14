import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canEditTimeData } from "@/lib/auth/permissions";
import { ComposeMemoForm } from "./ComposeMemoForm";
import { getOrgLists } from "@/lib/org/lists";

// Full-page compose flow. Server component gates access; the form is
// client-side (state, validation, uploads).
export default async function ComposeMemoPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canEditTimeData(session.user.permRole)) redirect("/management/memos");
  const { offices, departments } = await getOrgLists();

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="text-sm text-muted-foreground">
        <Link href="/management/memos" className="hover:underline">
          ← Back to memos
        </Link>
      </div>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Compose office memo</h1>
        <p className="text-muted-foreground mt-1">
          Publish now, save as draft, or schedule for later. Recipients are
          notified in the bell and (if configured) Slack.
        </p>
      </div>
      <ComposeMemoForm
        viewerRole={session.user.permRole || "employee"}
        viewerOffice={session.user.office ?? null}
        viewerDepartment={session.user.department ?? null}
        offices={offices}
        departments={departments}
      />
    </div>
  );
}
