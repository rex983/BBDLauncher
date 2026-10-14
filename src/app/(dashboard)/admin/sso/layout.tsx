import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

// Admin-only page (a client component), so the authoritative role check
// lives here. Middleware only does a cheap cookie-role pre-check, and the
// API routes this page calls enforce admin on their own.
export default async function AdminOnlyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!isAdmin(session?.user?.permRole)) redirect("/dashboard");
  return <>{children}</>;
}
