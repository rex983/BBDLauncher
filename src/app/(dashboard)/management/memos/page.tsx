import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canViewTimeData } from "@/lib/auth/permissions";
import { listMemosForManagement } from "@/lib/memos/queries";
import MemosShell from "./MemosShell";

export default async function MemosManagementPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canViewTimeData(session.user.role)) redirect("/dashboard");

  const supabase = createAdminClient();
  const initialRows = await listMemosForManagement({
    supabase,
    viewer: {
      profileId: session.user.profileId,
      role: session.user.role || "employee",
      office: session.user.office ?? null,
      department: session.user.department ?? null,
    },
  });

  return <MemosShell initialRows={initialRows} />;
}
