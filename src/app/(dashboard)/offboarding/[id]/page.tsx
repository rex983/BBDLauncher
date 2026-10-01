import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { getCaseDetail } from "@/lib/offboarding/service";
import { OffboardingCaseShell } from "@/components/features/offboarding/OffboardingCaseShell";

export default async function OffboardingCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, session] = await Promise.all([getCaseDetail(id), auth()]);
  if (!detail) notFound();
  return <OffboardingCaseShell initial={detail} isAdmin={isAdmin(session?.user?.role)} />;
}
