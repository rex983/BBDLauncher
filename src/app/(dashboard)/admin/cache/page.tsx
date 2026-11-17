import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listCacheTargets, type CacheTarget } from "@/lib/cache-clear";
import { CacheClearShell } from "@/components/features/admin/cache-clear-shell";

export const dynamic = "force-dynamic";

// Admins only, on the real role: the admin layout also lets manager tiers in,
// so this page gates itself (the API route does too).
export default async function AdminCachePage() {
  const session = await auth();
  if (session?.user?.role !== "admin") redirect("/dashboard");

  let targets: CacheTarget[] = [];
  let error: string | null = null;
  try {
    targets = await listCacheTargets();
  } catch (e) {
    error = e instanceof Error ? e.message : "Couldn't load the app list.";
  }
  return <CacheClearShell targets={targets} loadError={error} />;
}
