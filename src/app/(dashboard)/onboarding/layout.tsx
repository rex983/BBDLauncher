import { auth } from "@/auth";
import { notFound } from "next/navigation";
import { canUseOnboarding } from "@/lib/auth/permissions";

// Server-side gate for /onboarding — admins + manager tier. Everyone else
// gets a real 404, same as /offboarding.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || !canUseOnboarding(session.user.permRole)) notFound();
  return <>{children}</>;
}
