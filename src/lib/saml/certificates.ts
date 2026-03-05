import fs from "fs";
import path from "path";

let cachedCert: string | null = null;
let cachedKey: string | null = null;

// Vercel env vars may have literal \n instead of real newlines
function fixPemNewlines(pem: string): string {
  return pem.replace(/\\n/g, "\n");
}

export function getIdpCertificate(): string {
  if (cachedCert) return cachedCert;

  // Support cert content directly via env var (for Vercel/serverless)
  if (process.env.SAML_CERT) {
    cachedCert = fixPemNewlines(process.env.SAML_CERT);
    return cachedCert;
  }

  const certPath =
    process.env.SAML_CERT_PATH || path.join(process.cwd(), "certificates/idp-cert.pem");
  try {
    cachedCert = fs.readFileSync(certPath, "utf-8");
  } catch {
    cachedCert = "";
  }
  return cachedCert;
}

export function getIdpPrivateKey(): string {
  if (cachedKey) return cachedKey;

  // Support key content directly via env var (for Vercel/serverless)
  if (process.env.SAML_KEY) {
    cachedKey = fixPemNewlines(process.env.SAML_KEY);
    return cachedKey;
  }

  const keyPath =
    process.env.SAML_KEY_PATH || path.join(process.cwd(), "certificates/idp-key.pem");
  try {
    cachedKey = fs.readFileSync(keyPath, "utf-8");
  } catch {
    cachedKey = "";
  }
  return cachedKey;
}

export function getCertificateBody(): string {
  const cert = getIdpCertificate();
  return cert
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s/g, "");
}
