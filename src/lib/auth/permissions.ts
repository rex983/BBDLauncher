import type { Department, Office, UserRole } from "@/types/auth";

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

// Routes under /management/* — timesheets, schedules, time-off approvals.
// Restricted to admins + manager-tier only. Anything else 404s.
export const MANAGER_MANAGEMENT_PATHS = [
  "/management/timesheets",
  "/management/timeoff",
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

export function canAccessManagementPath(
  role: UserRole | undefined | null,
  pathname: string,
): boolean {
  if (role === "admin") return true;
  if (isManagerTier(role)) {
    return MANAGER_MANAGEMENT_PATHS.some((p) => pathname.startsWith(p));
  }
  return false;
}

// Only admins + manager-tier can view/edit time data.
export function canEditTimeData(role: UserRole | undefined | null): boolean {
  return isAdmin(role) || isManagerTier(role);
}

export function canViewTimeData(role: UserRole | undefined | null): boolean {
  return canEditTimeData(role);
}

// Time-data scope is department-only for manager-tier users. Admins see
// everyone (both null). A manager-tier user (senior_manager, junior_manager,
// or legacy manager) is constrained to their own department across ALL
// offices — a SALES TEAM manager sees SALES TEAM in Harbor, Marion, and
// anywhere else. Managers missing a department assignment get no access;
// assign one in /admin/users. The `office` field on the returned scope
// stays here as a shape-compatibility bridge — callers still read it, but
// it's always null now so their office filters become no-ops.
export type TimeDataScope =
  | { allowed: false }
  | {
      allowed: true;
      department: Department | null;
      office: Office | null;
    };

export function timeDataScope(
  role: UserRole | undefined | null,
  department: Department | null,
): TimeDataScope {
  if (role === "admin") return { allowed: true, department: null, office: null };
  if (isManagerTier(role)) {
    if (department) return { allowed: true, department, office: null };
    return { allowed: false };
  }
  return { allowed: false };
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
