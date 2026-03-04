import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptStrapiCookie } from "@/lib/auth/strapi-sso";
import type { UserRole } from "@/types/auth";

const isDev =
  process.env.NODE_ENV === "development" ||
  process.env.AUTH_DEV_BYPASS === "true";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
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
          .select("id, email, full_name, role, avatar_url")
          .eq("email", payload.email)
          .single();

        if (!profile) return null;

        return {
          id: profile.id,
          email: profile.email,
          name: profile.full_name || payload.name || null,
          image: profile.avatar_url || payload.avatar || null,
        };
      },
    }),
    // Email/password credentials — dev bypass when DB isn't available
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

        // Hardcoded admin account
        if (
          email === "rex@bigbuildingsdirect.com" &&
          password === process.env.ADMIN_PASSWORD
        ) {
          return {
            id: "admin-001",
            email,
            name: "Rex",
            image: null,
          };
        }

        // Dev bypass — allow any login without DB check
        if (isDev) {
          return {
            id: "dev-user-001",
            email,
            name: email.split("@")[0],
            image: null,
          };
        }

        // Production: validate against profiles table
        const supabase = createAdminClient();
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, email, full_name, role, avatar_url")
          .eq("email", email)
          .single();

        if (!profile) return null;

        return {
          id: profile.id,
          email: profile.email,
          name: profile.full_name || null,
          image: profile.avatar_url || null,
        };
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/auth-error",
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;

      // Hardcoded admin account — always allowed
      if (user.email === "rex@bigbuildingsdirect.com") return true;

      // Dev bypass — skip DB check
      if (isDev) return true;

      const supabase = createAdminClient();
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", user.email)
        .single();

      if (!profile) return false;

      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        // Hardcoded admin account + dev bypass — admin role without DB
        if (user.email === "rex@bigbuildingsdirect.com" || isDev) {
          token.role = (token.role as UserRole) || "admin";
          token.profileId = (token.profileId as string) || user.id || "admin-001";
          return token;
        }

        const supabase = createAdminClient();
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, role")
          .eq("email", user.email)
          .single();

        if (profile) {
          token.role = profile.role as UserRole;
          token.profileId = profile.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.role = token.role as import("@/types/auth").UserRole;
        session.user.profileId = token.profileId as string;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
});
