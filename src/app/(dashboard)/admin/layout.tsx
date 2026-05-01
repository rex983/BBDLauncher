import { auth } from "@/auth";
import { canManageContent } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user || !canManageContent(session.user.role)) {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
