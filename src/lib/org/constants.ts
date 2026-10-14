// Offices and departments are admin-managed (launcher_offices /
// launcher_departments, migration 051) and shared with every app on the
// database. Server code reads them with getOffices() / getDepartments()
// (src/lib/org/lists.ts); client components get them as props.
//
// The lists below are only the fallback for before migration 051 is applied
// (the tables don't exist yet), so deploy order is safe. Don't use them for
// validation or dropdowns directly.

export interface OrgItem {
  name: string;
  display_name: string;
  sort_order: number;
}

export const FALLBACK_OFFICES: readonly OrgItem[] = [
  { name: "Sales", display_name: "Sales", sort_order: 10 },
  { name: "BST", display_name: "BST", sort_order: 20 },
  { name: "RnD", display_name: "R&D", sort_order: 30 },
];

export const FALLBACK_DEPARTMENTS: readonly OrgItem[] = [
  { name: "SALES TEAM", display_name: "SALES TEAM", sort_order: 10 },
  { name: "BST", display_name: "BST", sort_order: 20 },
  { name: "RnD", display_name: "RnD", sort_order: 30 },
];

/** The access grid's "no office" row. Reserved: no office may be named this. */
export const NO_OFFICE = "none";

// Name formats for new entries (names are immutable once created). Offices
// look like `Sales` / `RnD`; departments like `SALES TEAM`.
export const OFFICE_NAME_RE = /^[A-Za-z0-9]{2,30}$/;
export const DEPARTMENT_NAME_RE = /^[A-Z0-9][A-Z0-9 ]{0,28}[A-Z0-9]$/;

/** Display label for an office / department; unknown names render as-is. */
export function orgLabel(
  list: readonly OrgItem[],
  name: string | null | undefined,
  empty = "—",
): string {
  if (!name) return empty;
  return list.find((i) => i.name === name)?.display_name ?? name;
}
