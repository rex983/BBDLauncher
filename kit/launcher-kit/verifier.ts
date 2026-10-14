import { createRemoteJWKSet, jwtVerify } from "jose";
import { adminClient, APP_AUDIENCE } from "./config";
import { LAUNCHER_JWKS_URL } from "./urls";

// Verifies the launcher's sign-in token (ES256, 60s, single use). See
// BBDLauncher src/lib/sso/jwt-issuer.ts for the issuing side.

const JWKS = createRemoteJWKSet(new URL(LAUNCHER_JWKS_URL));

/** The admin behind a launcher "View as" token (RFC 8693 actor claim). */
export interface LauncherActor {
  /** Admin email. */
  sub: string;
  profile_id: string;
  name: string;
}

export interface LauncherClaims {
  email: string;
  name: string;
  role: string;
  profile_id: string;
  office: string | null;
  department: string | null;
  is_it: boolean;
  /** Set when an admin opened the app viewing as this person. */
  act: LauncherActor | null;
}

export async function verifyLauncherToken(token: string): Promise<LauncherClaims> {
  const { payload } = await jwtVerify(token, JWKS, {
    algorithms: ["ES256"],
    issuer: "bbd-launcher",
    audience: APP_AUDIENCE,
    maxTokenAge: "120s",
    clockTolerance: "10s",
  });

  if (typeof payload.email !== "string" || !payload.email) {
    throw new Error("Launcher token has no email");
  }
  if (typeof payload.jti !== "string" || !payload.jti) {
    throw new Error("Launcher token has no jti");
  }

  let act: LauncherActor | null = null;
  if (payload.act !== undefined && payload.act !== null) {
    const raw = payload.act as Record<string, unknown>;
    if (
      typeof raw !== "object" ||
      typeof raw.sub !== "string" ||
      !raw.sub ||
      typeof raw.profile_id !== "string" ||
      !raw.profile_id
    ) {
      throw new Error("Launcher token has a malformed act claim");
    }
    act = {
      sub: raw.sub,
      profile_id: raw.profile_id,
      name: typeof raw.name === "string" ? raw.name : "",
    };
  }

  await consumeJti(payload.jti, payload.exp);

  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    email: payload.email,
    name: str(payload.name) ?? "",
    role: str(payload.role) ?? "",
    profile_id: str(payload.profile_id) ?? String(payload.sub ?? ""),
    office: str(payload.office),
    department: str(payload.department),
    is_it: payload.is_it === true,
    act,
  };
}

// Replay protection: each token (jti) can be redeemed once. The table is the
// launcher's (migration 045); if it's missing, log and allow.
async function consumeJti(jti: string, exp: number | undefined): Promise<void> {
  const expiresAt = new Date(
    (typeof exp === "number" ? exp : Math.floor(Date.now() / 1000) + 120) * 1000,
  ).toISOString();
  const { error } = await adminClient()
    .from("sso_consumed_jti")
    .insert({ jti, audience: APP_AUDIENCE, expires_at: expiresAt });
  if (!error) return;
  if (error.code === "23505") throw new Error("Launcher token already used");
  if (error.code === "42P01" || error.code === "PGRST205") {
    console.warn("[launcher-kit] sso_consumed_jti missing; replay protection off");
    return;
  }
  throw new Error(`Launcher token jti check failed: ${error.message}`);
}
