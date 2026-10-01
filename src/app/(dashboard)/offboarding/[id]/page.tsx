import { notFound } from "next/navigation";
import { getCaseDetail, listOffboarders } from "@/lib/offboarding/service";
import { OffboardingCaseShell } from "@/components/features/offboarding/OffboardingCaseShell";

export default async function OffboardingCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, offboarders] = await Promise.all([getCaseDetail(id), listOffboarders()]);
  if (!detail) notFound();
  return <OffboardingCaseShell initial={detail} offboarders={offboarders} />;
}
