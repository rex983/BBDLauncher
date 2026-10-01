import { auth } from "@/auth";
import { notFound } from "next/navigation";
import { canRunOffboarding } from "@/lib/auth/permissions";

// Server-side gate for /offboarding — admins + the offboarding team (profiles.can_offboard). Everyone else gets
// a real 404, same as /management.
export default async function OffboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || !canRunOffboarding(session.user.role, session.user.can_offboard)) notFound();
  return <>{children}</>;
}
