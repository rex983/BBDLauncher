import { auth } from "@/auth";
import { notFound } from "next/navigation";
import { canUseOnboarding, isAdmin } from "@/lib/auth/permissions";
import { listRequests } from "@/lib/onboarding/service";
import { OnboardingListShell } from "@/components/features/onboarding/OnboardingListShell";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) notFound();
  const requests = await listRequests(session);
  return (
    <OnboardingListShell
      initial={requests}
      isAdmin={isAdmin(session.user.permRole)}
      canOpen={canUseOnboarding(session.user.permRole)}
    />
  );
}
