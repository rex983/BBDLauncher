import fs from "fs";
import path from "path";

let cachedCert: string | null = null;
let cachedKey: string | null = null;

export function getIdpCertificate(): string {
  if (cachedCert) return cachedCert;
  const certPath =
    process.env.SAML_CERT_PATH || path.join(process.cwd(), "certificates/idp-cert.pem");
  cachedCert = fs.readFileSync(certPath, "utf-8");
  return cachedCert;
}

export function getIdpPrivateKey(): string {
  if (cachedKey) return cachedKey;
  const keyPath =
    process.env.SAML_KEY_PATH || path.join(process.cwd(), "certificates/idp-key.pem");
  cachedKey = fs.readFileSync(keyPath, "utf-8");
  return cachedKey;
}

export function getCertificateBody(): string {
  const cert = getIdpCertificate();
  return cert
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s/g, "");
}
