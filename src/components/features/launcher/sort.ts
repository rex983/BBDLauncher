// Dashboard "Sort by". Applies to every section, Favorites and the links.

export type SortMode = "az" | "za" | "most" | "least" | "recent" | "custom";

export const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "az", label: "A–Z" },
  { value: "za", label: "Z–A" },
  { value: "most", label: "Most clicked" },
  { value: "least", label: "Least clicked" },
  { value: "recent", label: "Recently used" },
  { value: "custom", label: "Custom order" },
];

export const DEFAULT_SORT: SortMode = "az";

export function isSortMode(v: unknown): v is SortMode {
  return SORT_OPTIONS.some((o) => o.value === v);
}

export interface ClickStat {
  clicks: number;
  lastAt: string;
}

/** The viewer's own opens, by app id and by link id. */
export interface ClickStats {
  apps: Record<string, ClickStat>;
  links: Record<string, ClickStat>;
}

interface Sortable {
  id: string;
  name: string;
  display_order: number;
}

const byName = (a: Sortable, b: Sortable) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

// Returns a sorted copy. Ties (same click count, never used) fall back to A–Z.
// "custom" is the drag order admins set.
export function sortItems<T extends Sortable>(
  items: T[],
  mode: SortMode,
  stats: Record<string, ClickStat>,
): T[] {
  const clicks = (x: T) => stats[x.id]?.clicks ?? 0;
  const last = (x: T) => stats[x.id]?.lastAt ?? "";
  const list = [...items];
  switch (mode) {
    case "custom":
      return list.sort((a, b) => a.display_order - b.display_order);
    case "za":
      return list.sort((a, b) => byName(b, a));
    case "most":
      return list.sort((a, b) => clicks(b) - clicks(a) || byName(a, b));
    case "least":
      return list.sort((a, b) => clicks(a) - clicks(b) || byName(a, b));
    case "recent":
      return list.sort((a, b) => last(b).localeCompare(last(a)) || byName(a, b));
    default:
      return list.sort(byName);
  }
}
