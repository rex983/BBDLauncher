import { getCachedSections } from "@/lib/launcher/cache";
import { SectionsShell } from "./SectionsShell";

// Server-rendered first paint from the launcher cache (same rows as GET
// /api/sections). The shell refetches the API after mutations.
export default async function AdminSectionsPage() {
  return <SectionsShell initial={await getCachedSections()} />;
}
