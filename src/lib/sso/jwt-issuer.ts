import { SignJWT, importPKCS8, exportJWK } from "jose";
import { randomUUID } from "crypto";

const ALG = "ES256";
let cachedPrivateKey: CryptoKey | null = null;

async function getPrivateKey(): Promise<CryptoKey> {
  if (cachedPrivateKey) return cachedPrivateKey;

  const pem = process.env.SSO_JWT_PRIVATE_KEY;
  if (!pem) {
    throw new Error("SSO_JWT_PRIVATE_KEY environment variable is not set");
  }

  cachedPrivateKey = await importPKCS8(pem, ALG);
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
