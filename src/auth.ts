import { cache } from "react";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptStrapiCookie } from "@/lib/auth/strapi-sso";
import { rateLimit } from "@/lib/rate-limit";
import type { Department, Office, UserRole } from "@/types/auth";
import type { JWT } from "next-auth/jwt";

// Hardcoded owner account — always admin, even before a profiles row exists.
const OWNER_EMAIL = "rex@bigbuildingsdirect.com";

// Copy the org claims (office / department / is_it / can_offboard) from a profiles row —
// or from the token itself when normalizing legacy tokens — onto the JWT.
function applyOrgClaims(token: JWT, row: Record<string, unknown>) {
  token.office = (row.office as Office | null) ?? null;
  token.department = (row.department as Department | null) ?? null;
  token.is_it = (row.is_it as boolean | null) ?? false;
  token.can_offboard = (row.can_offboard as boolean | null) ?? false;
}

// The jwt callback runs on every auth() call, and a single render calls auth()
// from several layouts/pages. React's per-request cache collapses those into
// one profiles read per request; outside a React render (e.g. middleware) it
// calls straight through. Either way every request reads fresh is_active /
// signed_out_at / session_version values.
const loadSessionProfile = cache(async (profileId: string) => {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("role, office, department, is_it, can_offboard, is_active, session_version, signed_out_at")
    .eq("id", profileId)
    .single();
  return data;
});

// Dev bypass ONLY in actual development, never via env var in production.
// Belt-and-suspenders: also refuse when running under Vercel (preview or
// production) so a mis-set NODE_ENV in a deployed environment can't enable
// the credential bypass. `VERCEL_ENV` is present on every Vercel deploy.
const isDev =
  process.env.NODE_ENV === "development" &&
  (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === "development");

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

        // Blunt brute-force: 5 attempts per email per 15 min. Keyed by the
        // submitted email so a distributed attacker can't scan by rotating
        // IPs — the guess space is what matters here.
        const rl = rateLimit(`login:${email.toLowerCase()}`, 5, 15 * 60_000);
        if (!rl.allowed) return null;

        // Hardcoded admin account — requires ADMIN_PASSWORD env var
        if (
          email === OWNER_EMAIL &&
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

        // Dev-only bypass — NEVER available in production. Restrict to
        // company domain and (if set) require DEV_PASSWORD so a shared dev
        // box or leaked NODE_ENV=development deploy can't be used to log in
        // as any address.
        if (isDev && email.endsWith("@bigbuildingsdirect.com")) {
          if (process.env.DEV_PASSWORD && password !== process.env.DEV_PASSWORD) {
            return null;
          }
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
      if (user.email === OWNER_EMAIL) return true;

      // Dev bypass — skip DB check only in actual development AND only for
      // company-domain emails (matches authorize()).
      if (isDev && user.email.endsWith("@bigbuildingsdirect.com")) return true;

      try {
        const supabase = createAdminClient();
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, is_active")
          .eq("email", user.email.toLowerCase())
          .single();

        if (!profile) return false;
        if (profile.is_active === false) return false;
      } catch {
        // If Supabase is unavailable, fall back to denying
        return false;
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        // Hardcoded admin account — admin role, but resolve profileId from DB
        // by email so audit/analytics rows link back to a real profile row.
        if (user.email === OWNER_EMAIL) {
          token.role = (token.role as UserRole) || "admin";
          try {
            const supabase = createAdminClient();
            const { data: profile } = await supabase
              .from("profiles")
              .select("id, office, department, is_it, can_offboard")
              .eq("email", user.email.toLowerCase())
              .single();
            if (profile) {
              token.profileId = profile.id;
              applyOrgClaims(token, profile);
              return token;
            }
          } catch {
            // fall through to legacy fallback
          }
          token.profileId = (token.profileId as string) || user.id || "admin-001";
          applyOrgClaims(token, token);
          return token;
        }

        // Dev bypass — assign admin only in development
        if (isDev) {
          token.role = (token.role as UserRole) || "admin";
          token.profileId = (token.profileId as string) || user.id;
          applyOrgClaims(token, token);
          return token;
        }

        const supabase = createAdminClient();
        const { data: profile } = await supabase
          .from("profiles")
          .select("id, role, office, department, is_it, can_offboard, session_version")
          .eq("email", user.email.toLowerCase())
          .single();

        if (profile) {
          token.role = profile.role as UserRole;
          token.profileId = profile.id;
          applyOrgClaims(token, profile);
          token.session_version = (profile.session_version as number | null) ?? 0;
        }
        return token;
      }

      // Auto-heal legacy tokens where rex's profileId was set to "admin-001"
      // or a Google sub before we started resolving to the real profiles.id.
      const email = token.email as string | undefined;
      if (
        email === OWNER_EMAIL &&
        (token.profileId === "admin-001" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            (token.profileId as string) ?? ""
          ))
      ) {
        try {
          const supabase = createAdminClient();
          const { data: profile } = await supabase
            .from("profiles")
            .select("id, office, department, is_it, can_offboard")
            .eq("email", email)
            .single();
          if (profile) {
            token.profileId = profile.id;
            applyOrgClaims(token, profile);
          }
        } catch {
          // ignore
        }
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
        const current = await loadSessionProfile(profileId);
        if (current) {
          // Deactivated: eject the session immediately. Returning null makes
          // the middleware bounce them to /login on the next request.
          if (current.is_active === false) return null;

          // Force-signout check: the nightly midnight cron bumps signed_out_at
          // for every profile. Any token issued before that timestamp is
          // treated as expired — returning null invalidates the session and
          // bounces the user to /login on their next request.
          const signedOutAtIso = current.signed_out_at as string | null;
          const iatSec = (token.iat as number | undefined) ?? 0;
          if (signedOutAtIso && iatSec > 0) {
            const signedOutSec = new Date(signedOutAtIso).getTime() / 1000;
            if (signedOutSec > iatSec) return null;
          }

          const dbVersion = (current.session_version as number | null) ?? 0;
          const tokenVersion = (token.session_version as number | undefined) ?? 0;
          if (dbVersion !== tokenVersion) {
            token.role = current.role as UserRole;
            applyOrgClaims(token, current);
            token.session_version = dbVersion;
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.role = token.role as UserRole;
        session.user.profileId = token.profileId as string;
        session.user.office = (token.office as Office | null) ?? null;
        session.user.department = (token.department as Department | null) ?? null;
        session.user.is_it = (token.is_it as boolean | undefined) ?? false;
        session.user.can_offboard = (token.can_offboard as boolean | undefined) ?? false;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
});
