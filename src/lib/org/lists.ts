// Server-side access to the admin-managed office / department lists
// (launcher_offices / launcher_departments, migration 051). Cached behind the
// launcher's tag-busted cache; /api/offices and /api/departments bust it.
// Never throws: on a read failure the pre-051 lists are used for that request.

import { getCachedDepartments, getCachedOffices } from "@/lib/launcher/cache";
import { FALLBACK_DEPARTMENTS, FALLBACK_OFFICES, type OrgItem } from "@/lib/org/constants";

export async function getOffices(): Promise<OrgItem[]> {
  try {
    return await getCachedOffices();
  } catch (err) {
    console.error("getOffices:", err);
    return [...FALLBACK_OFFICES];
  }
}

export async function getDepartments(): Promise<OrgItem[]> {
  try {
    return await getCachedDepartments();
  } catch (err) {
    console.error("getDepartments:", err);
    return [...FALLBACK_DEPARTMENTS];
  }
}

export async function getOrgLists(): Promise<{ offices: OrgItem[]; departments: OrgItem[] }> {
  const [offices, departments] = await Promise.all([getOffices(), getDepartments()]);
  return { offices, departments };
}

/** Office names, for validation and the access-grid helpers. */
export async function getOfficeNames(): Promise<string[]> {
  return (await getOffices()).map((o) => o.name);
}

export async function getDepartmentNames(): Promise<string[]> {
  return (await getDepartments()).map((d) => d.name);
}

/** Is this a known office? (null / empty = "no office" and is always fine.) */
export async function isKnownOffice(name: string | null | undefined): Promise<boolean> {
  if (!name) return true;
  return (await getOfficeNames()).includes(name);
}

export async function isKnownDepartment(name: string | null | undefined): Promise<boolean> {
  if (!name) return true;
  return (await getDepartmentNames()).includes(name);
}
