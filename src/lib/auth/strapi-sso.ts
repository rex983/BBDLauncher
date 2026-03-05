import * as jose from "jose";

interface StrapiSsoPayload {
  email: string;
  name?: string;
  avatar?: string;
  iat?: number;
  exp?: number;
}

/**
 * Derive the encryption key from the Strapi SSO secret using HKDF,
 * then decrypt the JWE cookie to extract user info.
 */
async function deriveKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("strapi-sso-salt"),
      info: encoder.encode("strapi-sso"),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function decryptStrapiCookie(
  cookieValue: string
): Promise<StrapiSsoPayload | null> {
  const secret = process.env.STRAPI_SSO_SECRET;
  if (!secret || !cookieValue) return null;

  try {
    const key = await deriveKey(secret);
    const jwk = await crypto.subtle.exportKey("jwk", key);
    const joseKey = await jose.importJWK(jwk, "A256GCM");
    const { payload } = await jose.jwtDecrypt(cookieValue, joseKey);
    return payload as unknown as StrapiSsoPayload;
  } catch (error) {
    console.error("Failed to decrypt Strapi SSO cookie:", error);
    return null;
  }
}

