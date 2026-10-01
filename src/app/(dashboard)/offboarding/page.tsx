import { createAdminClient } from "@/lib/supabase/admin";
import { listCases } from "@/lib/offboarding/service";
import { OffboardingListShell } from "@/components/features/offboarding/OffboardingListShell";

export default async function OffboardingPage() {
  const supabase = createAdminClient();
  const [cases, { data: people }] = await Promise.all([
    listCases(),
    supabase
      .from("profiles")
      .select("id, email, name:full_name, role, office, department, is_active")
      .order("full_name", { ascending: true }),
  ]);
  return <OffboardingListShell initialCases={cases} people={people || []} />;
}
