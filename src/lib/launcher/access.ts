// App access: an office × role grid per app (migration 034).
//
// Each launcher_role_app_access row is (role, app, office):
//   office null     → that role can open the app from every office
//   office "Sales"  → only from that office
//   office "none"   → only people with no office set
// Admins are still gated by role (they need an admin row) but ignore office.
// Pure — shared by the dashboard, /api/launch and the admin app form.

import { OFFICES } from "@/lib/org/constants";

/** Grid rows: the launcher offices plus people with no office. */
export const ACCESS_OFFICES = [...OFFICES, "none"] as const;
export type AccessOffice = (typeof ACCESS_OFFICES)[number];
export const ACCESS_OFFICE_LABEL: Record<AccessOffice, string> = {
  Sales: "Sales",
  BST: "BST",
  RnD: "R&D",
  none: "No office",
};

export interface AccessRow {
  role_name: string;
  app_id: string;
  office: string | null;
}

/** A ticked grid cell. */
export interface AccessCell {
  role: string;
  office: AccessOffice;
}

/** The grid row a person falls in. */
export function officeRow(office: string | null | undefined): AccessOffice {
  return (OFFICES as readonly string[]).includes(office ?? "") ? (office as AccessOffice) : "none";
}

/**
 * Can someone with this role and office open the app? `ignoreOffice` is the
 * admin bypass (off when an admin pins a "view as office").
 */
export function rowsAllow(rows: AccessRow[], role: string, office: string | null | undefined, ignoreOffice = false): boolean {
  const row = officeRow(office);
  return rows.some((r) => r.role_name === role && (ignoreOffice || r.office === null || r.office === row));
}

/** App ids a person can open, from every access row. */
export function allowedAppIds(rows: AccessRow[], role: string, office: string | null | undefined, ignoreOffice = false): Set<string> {
  const row = officeRow(office);
  const out = new Set<string>();
  for (const r of rows) {
    if (r.role_name === role && (ignoreOffice || r.office === null || r.office === row)) out.add(r.app_id);
  }
  return out;
}

/** Rows → ticked cells (a null-office row ticks the role's whole column). */
export function cellsFromRows(rows: Array<{ role_name: string; office: string | null }>): AccessCell[] {
  const out = new Map<string, AccessCell>();
  for (const r of rows) {
    const offices = r.office === null ? ACCESS_OFFICES : ACCESS_OFFICES.filter((o) => o === r.office);
    for (const o of offices) out.set(`${o}|${r.role_name}`, { role: r.role_name, office: o });
  }
  return [...out.values()];
}

/** Ticked cells → compact rows: a role ticked in every office becomes one null-office row. */
export function rowsFromCells(appId: string, cells: AccessCell[]): AccessRow[] {
  const byRole = new Map<string, Set<AccessOffice>>();
  for (const c of cells) {
    if (!(ACCESS_OFFICES as readonly string[]).includes(c.office)) continue;
    const set = byRole.get(c.role) ?? new Set<AccessOffice>();
    set.add(c.office);
    byRole.set(c.role, set);
  }
  const rows: AccessRow[] = [];
  for (const [role, set] of byRole) {
    if (set.size === ACCESS_OFFICES.length) rows.push({ role_name: role, app_id: appId, office: null });
    else for (const o of ACCESS_OFFICES) if (set.has(o)) rows.push({ role_name: role, app_id: appId, office: o });
  }
  return rows;
}

/** Offices with any access, for list badges; null = every office. */
export function officesWithAccess(rows: Array<{ office: string | null }>): AccessOffice[] | null {
  if (rows.some((r) => r.office === null)) return null;
  return ACCESS_OFFICES.filter((o) => rows.some((r) => r.office === o));
}

// Individual people (migration 040): launcher_user_access rows grant one person
// an app or a link on top of the grid / office filter.

export interface UserAccessRow {
  profile_id: string;
  app_id: string | null;
  link_id: string | null;
}

/** App and link ids granted to one person. */
export function personalGrants(rows: UserAccessRow[], profileId: string | null | undefined) {
  const apps = new Set<string>();
  const links = new Set<string>();
  if (!profileId) return { apps, links };
  for (const r of rows) {
    if (r.profile_id !== profileId) continue;
    if (r.app_id) apps.add(r.app_id);
    if (r.link_id) links.add(r.link_id);
  }
  return { apps, links };
}
