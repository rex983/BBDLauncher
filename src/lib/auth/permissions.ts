import type { UserRole } from "@/types/auth";

// Routes under /admin/* that managers are allowed to access. Anything else
// stays admin-only (e.g., /admin/roles, /admin/sso).
export const MANAGER_ADMIN_PATHS = [
  "/admin/apps",
  "/admin/sections",
  "/admin/links",
  "/admin/users",
  "/admin/manufacturers",
];

export function isAdmin(role: UserRole | undefined | null): boolean {
  return role === "admin";
}

// True when the user can write to the launcher's managed content
// (apps, sections, links, users, manufacturers).
export function canManageContent(role: UserRole | undefined | null): boolean {
  return role === "admin" || role === "manager";
}

export function canAccessAdminPath(
  role: UserRole | undefined | null,
  pathname: string,
): boolean {
  if (role === "admin") return true;
  if (role === "manager") {
    return MANAGER_ADMIN_PATHS.some((p) => pathname.startsWith(p));
  }
  return false;
}
