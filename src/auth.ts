import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptStrapiCookie } from "@/lib/auth/strapi-sso";
import type { Office, UserRole } from "@/types/auth";

// Dev bypass ONLY in actual development, never via env var in production
const isDev = process.env.NODE_ENV === "development";

// AUTH_SECRET signs/encrypts JWTs — refuse to start without it in production
// rather than fall back to an unstable per-deploy secret that breaks sessions.
if (!isDev && !process.env.AUTH_SECRET) {
  throw new Error("AUTH_SECRET is required in production");
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          hd: "bigbuildingsdirect.com",
          prompt: "select_account",
        },
      },
    }),
    Credentials({
      id: "strapi-sso",
      name: "Strapi SSO",
      credentials: {
        cookie: { type: "text" },
      },
      async authorize(credentials) {
        const cookieValue = credentials?.cookie as string;
        if (!cookieValue) return null;

        const payload = await decryptStrapiCookie(cookieValue);
        if (!payload?.email) return null;

        const supabase = createAdminClient();
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, email, full_name, role")
          .eq("email", payload.email.toLowerCase())
          .single();

        if (!profile) return null;

        return {
          id: profile.id,
          email: profile.email,
          name: profile.full_name || payload.name || null,
          image: null,
        };
      },
    }),
    Credentials({
      id: "credentials",
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string;
        const password = credentials?.password as string;
        if (!email || !password) return null;

        // Hardcoded admin account — requires ADMIN_PASSWORD env var
        if (
          email === "rex@bigbuildingsdirect.com" &&
          process.env.ADMIN_PASSWORD &&
          password === process.env.ADMIN_PASSWORD
        ) {
          return {
            id: "admin-001",
            email,
            name: "Rex",
            image: null,
          };
        }

        // Dev-only bypass — NEVER available in production
        if (isDev) {
          // Generate a deterministic but unique ID per email, not a shared ID
          const devId = `dev-${Buffer.from(email).toString("base64url").slice(0, 16)}`;
          return {
            id: devId,
            email,
            name: email.split("@")[0],
            image: null,
          };
        }

        // Production: credentials login is not supported without password hashing.
        // Only Google OAuth and Strapi SSO should be used in production.
        // If you need credentials login, add a password_hash column to profiles
        // and verify with bcrypt here.
        return null;
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/auth-error",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;

      // Google sign-in: restrict to @bigbuildingsdirect.com
      if (account?.provider === "google") {
        if (!user.email.endsWith("@bigbuildingsdirect.com")) return false;
        return true;
      }

      // Hardcoded admin account — always allowed
      if (user.email === "rex@bigbuildingsdirect.com") return true;

      // Dev bypass — skip DB check only in actual development
      if (isDev) return true;

      try {
        const supabase = createAdminClient();
        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("email", user.email.toLowerCase())
          .single();

        if (!profile) return false;
      } catch {
        // If Supabase is unavailable, fall back to denying
        return false;
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        // Hardcoded admin account — admin role without DB
        if (user.email === "rex@bigbuildingsdirect.com") {
          token.role = (token.role as UserRole) || "admin";
          token.profileId = (token.profileId as string) || user.id || "admin-001";
          token.office = (token.office as Office | null) ?? null;
          return token;
        }

        // Dev bypass — assign admin only in development
        if (isDev) {
          token.role = (token.role as UserRole) || "admin";
          token.profileId = (token.profileId as string) || user.id;
          token.office = (token.office as Office | null) ?? null;
          return token;
        }

        const supabase = createAdminClient();
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, role, office, session_version")
          .eq("email", user.email.toLowerCase())
          .single();

        if (profile) {
          token.role = profile.role as UserRole;
          token.profileId = profile.id;
          token.office = (profile.office as Office | null) ?? null;
          token.session_version = (profile.session_version as number | null) ?? 0;
        }
        return token;
      }

      // Subsequent requests: refresh role/office if the DB's session_version
      // has been bumped (admin changed role or office). Without this, JWTs
      // carry stale claims until the user signs out and back in.
      const profileId = token.profileId as string | undefined;
      if (
        profileId &&
        profileId !== "admin-001" &&
        !profileId.startsWith("dev-")
      ) {
        const supabase = createAdminClient();
        const { data: current } = await supabase
          .from("profiles")
          .select("role, office, session_version")
          .eq("id", profileId)
          .single();
        if (current) {
          const dbVersion = (current.session_version as number | null) ?? 0;
          const tokenVersion = (token.session_version as number | undefined) ?? 0;
          if (dbVersion !== tokenVersion) {
            token.role = current.role as UserRole;
            token.office = (current.office as Office | null) ?? null;
            token.session_version = dbVersion;
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.role = token.role as import("@/types/auth").UserRole;
        session.user.profileId = token.profileId as string;
        session.user.office = (token.office as Office | null) ?? null;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
});
