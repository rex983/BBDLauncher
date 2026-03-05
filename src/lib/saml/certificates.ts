import fs from "fs";
import path from "path";

let cachedCert: string | null = null;
let cachedKey: string | null = null;

// Vercel env vars may mangle PEM formatting — reconstruct properly
function fixPem(pem: string): string {
  // Replace literal \n with real newlines
  let fixed = pem.replace(/\\n/g, "\n");

  // If it's all on one line with no newlines between header/body/footer,
  // reconstruct it by extracting the base64 body and re-wrapping
  const match = fixed.match(/(-----BEGIN [A-Z ]+-----)([\s\S]*?)(-----END [A-Z ]+-----)/);
  if (match) {
    const header = match[1];
    const body = match[2].replace(/\s/g, ""); // strip all whitespace
    const footer = match[3];
    // Re-wrap base64 at 64 chars per line
    const wrapped = body.match(/.{1,64}/g)?.join("\n") || body;
    fixed = `${header}\n${wrapped}\n${footer}\n`;
  }

  return fixed;
}

export function getIdpCertificate(): string {
  if (cachedCert) return cachedCert;

  // Support cert content directly via env var (for Vercel/serverless)
  if (process.env.SAML_CERT) {
    cachedCert = fixPem(process.env.SAML_CERT);
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
    cachedKey = fixPem(process.env.SAML_KEY);
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
