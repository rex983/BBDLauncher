import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ManufacturerChange, ManufacturerConfig, ManufacturerDetail, ManufacturerRow } from "@/types/manufacturer";

// Manufacturers as the launcher shows them: the manufacturer_config row plus
// what the Manufacturer Hub keeps about the same manufacturer (logo, headline,
// HQ, its hub page), and the change history. Everything hub-side is optional:
// a manufacturer the hub hasn't picked up yet simply has none of it.

const HUB_URL = (process.env.MANUFACTURER_HUB_URL || "https://bbd-manufacturer-hub.vercel.app").replace(/\/+$/, "");

type HubRow = {
  id: string;
  slug: string | null;
  logo_url: string | null;
  headline: string | null;
  hq_location: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function withHub(m: ManufacturerConfig, hub: HubRow | undefined): ManufacturerRow {
  return {
    ...m,
    // Only web addresses are usable as an <img> src from here.
    logo_url: hub?.logo_url && /^https?:\/\//i.test(hub.logo_url) ? hub.logo_url : null,
    headline: hub?.headline ?? null,
    hq_location: hub?.hq_location ?? null,
    hub_url: hub?.slug ? `${HUB_URL}/manufacturers/${encodeURIComponent(hub.slug)}` : null,
  };
}

async function hubRows(ids?: string[]): Promise<Map<string, HubRow>> {
  try {
    let q = createAdminClient().from("mfr_hub_manufacturer").select("id, slug, logo_url, headline, hq_location");
    if (ids) q = q.in("id", ids);
    const { data } = await q;
    return new Map(((data ?? []) as HubRow[]).map((r) => [r.id, r]));
  } catch {
    return new Map();
  }
}

/** Every manufacturer, by name. Throws on a read failure. */
export async function listManufacturers(): Promise<ManufacturerRow[]> {
  const [{ data, error }, hub] = await Promise.all([
    createAdminClient().from("manufacturer_config").select("*").order("name"),
    hubRows(),
  ]);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ManufacturerConfig[]).map((m) => withHub(m, hub.get(m.id)));
}

type ChangeRow = {
  id?: string | number;
  action: string;
  changes: unknown;
  user_id: string | null;
  user_email: string | null;
  created_at?: string;
  changed_at?: string;
};

/** One manufacturer with its change history (newest first), or null. */
export async function loadManufacturerDetail(id: string, historyLimit = 100): Promise<ManufacturerDetail | null> {
  if (!UUID.test(id)) return null;
  const supabase = createAdminClient();
  const [{ data }, hub, logRes] = await Promise.all([
    supabase.from("manufacturer_config").select("*").eq("id", id).maybeSingle(),
    hubRows([id]),
    supabase.from("manufacturer_config_changelog").select("*").eq("config_id", id).limit(500),
  ]);
  if (!data) return null;

  const rows = ((logRes.data ?? []) as ChangeRow[])
    .map((r) => ({ ...r, at: r.created_at ?? r.changed_at ?? null }))
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, historyLimit);

  // Names for the people behind each change.
  const ids = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => !!v && UUID.test(v)))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: people } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
    for (const p of people ?? []) names.set(p.id as string, (p.full_name as string | null) || (p.email as string));
  }

  const history: ManufacturerChange[] = rows.map((r, i) => ({
    id: String(r.id ?? `${r.at}-${i}`),
    at: r.at,
    action: r.action,
    changes: Array.isArray(r.changes) ? (r.changes as ManufacturerChange["changes"]) : [],
    actor_id: r.user_id && names.has(r.user_id) ? r.user_id : null,
    actor:
      (r.user_id && names.get(r.user_id)) ||
      (r.user_email === "strapi-sync" ? "Strapi sync" : r.user_email) ||
      "System",
  }));

  return { ...withHub(data as ManufacturerConfig, hub.get(id)), history };
}
