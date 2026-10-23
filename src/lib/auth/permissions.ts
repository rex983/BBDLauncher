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
  "/management/attendance",
  "/management/timeoff",
  "/management/incidents",
  "/management/memos",
  "/management/teams",
];

export function isAdmin(role: UserRole | undefined | null): boolean {
  return role === "admin";
}

// Roles the app code gives a meaning to (mirrors launcher_builtin_roles() in
// migration 051). Custom roles get one of these roles' permissions through
// launcher_roles.acts_as; built-ins can't have acts_as themselves.
export const BUILTIN_ROLES: ReadonlySet<UserRole> = new Set([
  "admin",
  "senior_manager",
  "junior_manager",
  "team_lead",
  "sales_rep",
  "bst",
  "rnd",
  "cancellations_dept",
  "revisions_dept",
]);

/** Roles a custom role may act as: every built-in except admin. */
export function isActsAsTarget(role: string): boolean {
  return BUILTIN_ROLES.has(role) && role !== "admin";
}

/**
 * The role permission checks use: acts_as ?? role. Mirrors
 * launcher_permission_role() but never yields "admin" for a non-admin role,
 * whatever the table says. Unknown roles stay as they are (least privilege).
 */
export function permRoleFor(
  role: UserRole | null | undefined,
  roles: ReadonlyArray<{ name: string; acts_as?: string | null }>,
): UserRole {
  if (!role) return "";
  if (role === "admin") return role;
  const target = roles.find((r) => r.name === role)?.acts_as;
  return target && target !== "admin" ? target : role;
}

// Roles that get manager-tier privileges (canManageContent + office-scoped
// analytics + MANAGER_ADMIN_PATHS access). Kept as a set so it's easy to
// extend when the org chart adds a new manager rank.
export const MANAGER_TIER_ROLES = new Set<UserRole>([
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

// Time-data scope layers department + office for manager-tier users.
// Admins see everyone (both null). A manager-tier user (senior_manager or
// junior_manager) is constrained to employees in
// BOTH their department AND their office. Managers missing either
// assignment get no access; assign both in /admin/users.
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
  office: Office | null,
): TimeDataScope {
  if (role === "admin") return { allowed: true, department: null, office: null };
  if (isManagerTier(role)) {
    if (department && office) return { allowed: true, department, office };
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

// Employee offboarding (/offboarding): admins plus the named offboarding team.
// It deactivates accounts and exports personal records, so manager-tier alone
// isn't enough — tick "Offboarding" in /admin/users to grant it.
export function canRunOffboarding(
  role: UserRole | undefined | null,
  canOffboard: boolean | undefined | null,
): boolean {
  return isAdmin(role) || !!canOffboard;
}

export type TeamScope =
  | { allowed: false }
  | { allowed: true; office: Office | null };

// Teams (/management/teams): admins manage every office's teams; manager-tier
// users manage the teams in their own office. A manager with no office gets
// nothing rather than "every office".
export function teamScope(
  role: UserRole | undefined | null,
  office: Office | null,
): TeamScope {
  if (role === "admin") return { allowed: true, office: null };
  if (isManagerTier(role) && office) return { allowed: true, office };
  return { allowed: false };
}
