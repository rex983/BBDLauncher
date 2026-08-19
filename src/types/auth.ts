// Roles are stored as text and are admin-managed via /admin/roles, so this
// is a string at the type level. The hardcoded permission tiers ("admin",
// "manager") in src/lib/auth/permissions.ts still gate admin UI access —
// new roles created at runtime are app-access labels only.
export type UserRole = string;

export type Office = "Harbor" | "Marion" | "BST" | "RnD";

export type Department = "SALES TEAM" | "BST" | "RnD";

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  office: Office | null;
  department: Department | null;
  is_it: boolean;
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
      role: UserRole;
      profileId: string;
      office: Office | null;
      department: Department | null;
      is_it: boolean;
    };
  }

  interface JWT {
    role: UserRole;
    profileId: string;
    office: Office | null;
    department?: Department | null;
    is_it?: boolean;
    session_version?: number;
  }
}
