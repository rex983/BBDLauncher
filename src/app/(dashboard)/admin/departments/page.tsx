import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { loadOrgAdmin } from "@/lib/org/admin";
import { FALLBACK_DEPARTMENTS } from "@/lib/org/constants";
import { OrgListShell } from "@/components/features/admin/org-list-shell";

// Admins only, on the real role: the admin layout also lets manager tiers in,
// so this page gates itself (the middleware does too).
export default async function AdminDepartmentsPage() {
  const session = await auth();
  if (session?.user?.role !== "admin") redirect("/dashboard");

  const { items, missing, people } = await loadOrgAdmin("departments");
  return (
    <OrgListShell
      kind="departments"
      initial={missing ? [...FALLBACK_DEPARTMENTS] : items}
      people={people}
      missing={missing}
    />
  );
}
