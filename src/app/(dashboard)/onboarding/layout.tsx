import { auth } from "@/auth";
import { notFound } from "next/navigation";
import { canUseOnboarding } from "@/lib/auth/permissions";
import { assignedRequestIds } from "@/lib/onboarding/service";

// Server-side gate for /onboarding — admins + manager tier, plus anyone on a
// checklist item (they see only those requests). Everyone else gets a real
// 404, same as /offboarding.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) notFound();
  if (!canUseOnboarding(session.user.permRole) && !(await assignedRequestIds(session.user.profileId)).length) notFound();
  return <>{children}</>;
}
