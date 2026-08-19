import type { Office, UserRole } from "@/types/auth";

// Routes under /admin/* that managers are allowed to access. Anything else
// stays admin-only (e.g., /admin/roles, /admin/sso).
export const MANAGER_ADMIN_PATHS = [
  "/admin/apps",
  "/admin/sections",
  "/admin/links",
  "/admin/users",
  "/admin/manufacturers",
  "/admin/analytics",
];

export function isAdmin(role: UserRole | undefined | null): boolean {
  return role === "admin";
}

// Roles that get manager-tier privileges (canManageContent + office-scoped
// analytics + MANAGER_ADMIN_PATHS access). Kept as a set so it's easy to
// extend when the org chart adds a new manager rank. The legacy 'manager'
// role stays for backwards compatibility with profiles that haven't been
// migrated to the new senior/junior split.
export const MANAGER_TIER_ROLES = new Set<UserRole>([
  "manager",
  "senior_manager",
  "junior_manager",
]);

function isManagerTier(role: UserRole | undefined | null): boolean {
  return !!role && MANAGER_TIER_ROLES.has(role);
}

// True when the user can write to the launcher's managed content
// (apps, sections, links, users, manufacturers).
export function canManageContent(role: UserRole | undefined | null): boolean {
  return role === "admin" || isManagerTier(role);
}

export function canAccessAdminPath(
  role: UserRole | undefined | null,
  pathname: string,
): boolean {
  if (role === "admin") return true;
  if (isManagerTier(role)) {
    return MANAGER_ADMIN_PATHS.some((p) => pathname.startsWith(p));
  }
  return false;
}

export type AnalyticsScope =
  | { allowed: false }
  | { allowed: true; office: Office | null };

// Who can see analytics, and whose activity they can see. Admins and BST
// managers see everyone; other managers only see their own office. Managers
// with no office assignment get no access rather than "all offices".
export function analyticsScope(
  role: UserRole | undefined | null,
  office: Office | null,
): AnalyticsScope {
  if (role === "admin") return { allowed: true, office: null };
  if (isManagerTier(role)) {
    if (office === "BST") return { allowed: true, office: null };
    if (office) return { allowed: true, office };
    return { allowed: false };
  }
  return { allowed: false };
}
