import { notFound } from "next/navigation";
import { getCaseDetail } from "@/lib/offboarding/service";
import { OffboardingCaseShell } from "@/components/features/offboarding/OffboardingCaseShell";

export default async function OffboardingCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getCaseDetail(id);
  if (!detail) notFound();
  return <OffboardingCaseShell initial={detail} />;
}
