import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { getDetail } from "@/lib/onboarding/service";
import { OnboardingDetailShell } from "@/components/features/onboarding/OnboardingDetailShell";

export default async function OnboardingRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) notFound();
  const detail = await getDetail(session, id);
  if (!detail) notFound();
  return (
    <OnboardingDetailShell
      initial={detail}
      isAdmin={isAdmin(session.user.permRole)}
      isRequester={detail.created_by === session.user.profileId}
    />
  );
}
