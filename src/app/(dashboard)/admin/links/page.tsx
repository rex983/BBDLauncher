import { getCachedLinks, getCachedUserAccess } from "@/lib/launcher/cache";
import type { ImportantLink } from "@/types/link";
import { LinksShell } from "./LinksShell";

// Server-rendered first paint from the launcher cache — the same rows GET
// /api/links returns to content managers (the admin layout gates this page
// to them), people included. The shell refetches the API after mutations.
export default async function AdminLinksPage() {
  const [links, userAccess] = await Promise.all([getCachedLinks(), getCachedUserAccess()]);
  const usersByLinkId = new Map<string, string[]>();
  for (const u of userAccess) {
    if (!u.link_id) continue;
    const list = usersByLinkId.get(u.link_id) ?? [];
    list.push(u.profile_id);
    usersByLinkId.set(u.link_id, list);
  }
  const initial: ImportantLink[] = links.map((l) => ({ ...l, user_ids: usersByLinkId.get(l.id) || [] }));
  return <LinksShell initial={initial} />;
}
