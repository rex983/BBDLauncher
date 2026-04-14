import { SignJWT, importPKCS8, exportJWK } from "jose";
import { randomUUID } from "crypto";

const ALG = "ES256";
let cachedPrivateKey: CryptoKey | null = null;

async function getPrivateKey(): Promise<CryptoKey> {
  if (cachedPrivateKey) return cachedPrivateKey;

  const raw = process.env.SSO_JWT_PRIVATE_KEY;
  if (!raw) {
    throw new Error("SSO_JWT_PRIVATE_KEY environment variable is not set");
  }

  // Normalize the PEM:
  //  1. Convert literal \n sequences to real newlines (Vercel sometimes
  //     stores multi-line env vars that way).
  //  2. Strip leading/trailing whitespace from each line — when pasting
  //     from indented contexts (code blocks, markdown) the PEM header
  //     can pick up leading spaces, which breaks PKCS#8 parsing.
  const pem = (raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw)
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();

  // extractable: true is required so we can derive the public JWK for /api/sso/jwks.
  // Without it, exportJWK throws "non-extractable CryptoKey cannot be exported".
  cachedPrivateKey = await importPKCS8(pem, ALG, { extractable: true });
  return cachedPrivateKey;
}

export async function getPublicJwk() {
  const privateKey = await getPrivateKey();
  const jwk = await exportJWK(privateKey);
  // Only expose the public portion
  delete jwk.d;
  jwk.alg = ALG;
  jwk.use = "sig";
  jwk.kid = "bbd-sso-1";
  return jwk;
}

interface SsoTokenParams {
  email: string;
  name: string;
  role: string;
  profileId: string;
  audience: string;
}

export async function generateSsoToken(params: SsoTokenParams): Promise<string> {
  const privateKey = await getPrivateKey();

  return new SignJWT({
    email: params.email,
    name: params.name,
    role: params.role,
    profile_id: params.profileId,
  })
    .setProtectedHeader({ alg: ALG, kid: "bbd-sso-1" })
    .setIssuer("bbd-launcher")
    .setSubject(params.email)
    .setAudience(params.audience)
    .setExpirationTime("60s")
    .setIssuedAt()
    .setJti(randomUUID())
    .sign(privateKey);
}
