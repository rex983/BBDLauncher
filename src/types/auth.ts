// Roles are stored as text and are admin-managed via /admin/roles, so this
// is a string at the type level. The hardcoded permission tiers in
// src/lib/auth/permissions.ts (isAdmin / MANAGER_TIER_ROLES) gate admin UI
// access; a custom role gets a built-in role's permissions through
// launcher_roles.acts_as (migration 051) — see `permRole` on the session.
export type UserRole = string;

// Offices and departments are admin-managed (launcher_offices /
// launcher_departments, migration 051), so any string is possible.
export type Office = string;

export type Department = string;

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  office: Office | null;
  department: Department | null;
  is_it: boolean;
  can_offboard: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string | null;
      image: string | null;
      /** Real role — display, the access grid and launch tokens. */
      role: UserRole;
      /** Role used for permission checks: acts_as ?? role (migration 051). */
      permRole: UserRole;
      profileId: string;
      office: Office | null;
      department: Department | null;
      is_it: boolean;
      can_offboard: boolean;
    };
  }

  interface JWT {
    role: UserRole;
    permRole?: UserRole;
    profileId: string;
    office: Office | null;
    department?: Department | null;
    is_it?: boolean;
    can_offboard?: boolean;
    session_version?: number;
  }
}
