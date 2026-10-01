import { auth } from "@/auth";
import { notFound } from "next/navigation";
import { canRunOffboarding } from "@/lib/auth/permissions";

// Server-side gate for /offboarding — admins + IT only. Everyone else gets
// a real 404, same as /management.
export default async function OffboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || !canRunOffboarding(session.user.role, session.user.is_it)) notFound();
  return <>{children}</>;
}
