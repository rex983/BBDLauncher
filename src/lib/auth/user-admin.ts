import type { Office, UserRole } from "@/types/auth";

// What a manager-tier (non-admin) user may do to profiles in /admin/users.
// Admins skip all of this. Managers can only manage people in their own
// office who rank below them, and only hand out roles below their own — so
// nobody can widen their own scope or mint a peer.

const ROLE_RANK: Partial<Record<UserRole, number>> = {
  admin: 3,
  senior_manager: 2,
  junior_manager: 1,
};

export function roleRank(role: UserRole | string | null | undefined): number {
  return (role && ROLE_RANK[role as UserRole]) || 0;
}

interface Viewer {
  role: UserRole;
  office: Office | null;
}

interface Target {
  role: string | null;
  office: string | null;
}

// Can this manager touch the target at all? Returns an error message or null.
export function managerTargetError(viewer: Viewer, target: Target): string | null {
  if (roleRank(target.role) >= roleRank(viewer.role)) {
    return "You can only manage people below your own role.";
  }
  if (target.office && target.office !== viewer.office) {
    return "You can only manage people in your own office.";
  }
  return null;
}

// Can this manager assign these values? Only fields being set are checked.
export function managerAssignError(
  viewer: Viewer,
  next: { role?: string; office?: string | null },
): string | null {
  if (next.role !== undefined && roleRank(next.role) >= roleRank(viewer.role)) {
    return "You can only assign roles below your own.";
  }
  if (next.office !== undefined && next.office !== null && next.office !== viewer.office) {
    return "You can only assign people to your own office.";
  }
  return null;
}
