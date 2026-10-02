import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth/permissions";
import { listCases } from "@/lib/offboarding/service";
import { OffboardingListShell } from "@/components/features/offboarding/OffboardingListShell";

export default async function OffboardingPage() {
  const supabase = createAdminClient();
  const [cases, { data: people }, session] = await Promise.all([
    listCases(),
    supabase
      .from("profiles")
      .select("id, email, name:full_name, role, office, department, is_active, can_offboard")
      .order("full_name", { ascending: true }),
    auth(),
  ]);
  return <OffboardingListShell initialCases={cases} people={people || []} isAdmin={isAdmin(session?.user?.role)} />;
}
