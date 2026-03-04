export type UserRole = "admin" | "manager" | "sales_rep" | "bst" | "rnd";

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
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
    };
  }

  interface JWT {
    role: UserRole;
    profileId: string;
  }
}
