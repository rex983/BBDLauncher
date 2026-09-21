// SHA-256 evidence chain for incident-report signatures. The point isn't
// cryptographic secrecy (there's nothing hidden here) — it's tamper
// detection. A verifier who has the row can recompute each hash from the
// inputs and prove the document + signatures haven't drifted since signing.
//
// Design:
//   1. document_hash              = sha256(document body captured at manager
//                                          sign time)
//   2. manager_signature_hash     = sha256("manager" || pipe-separated fields)
//   3. employee_signature_hash    = sha256("employee" || pipe-separated
//                                          fields, chained on manager hash)
//
// Chaining employee-onto-manager means editing either signature or the
// document breaks the chain — a verifier sees the mismatch immediately.

import { createHash } from "crypto";

const DELIMITER = "|";

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashDocument(document: string): string {
  // Normalize CRLF → LF so a signature captured on Windows verifies on
  // any platform when the row is exported/imported through anything that
  // rewrites line endings.
  return sha256(document.replace(/\r\n/g, "\n"));
}

export function hashManagerSignature(params: {
  documentHash: string;
  signatureText: string;
  signedAt: string;
  ip: string | null;
  ua: string | null;
}): string {
  return sha256(
    [
      "manager",
      params.documentHash,
      params.signatureText.trim(),
      params.signedAt,
      params.ip || "",
      params.ua || "",
    ].join(DELIMITER),
  );
}

export function hashEmployeeSignature(params: {
  documentHash: string;
  managerSignatureHash: string;
  signatureText: string;
  signedAt: string;
  ip: string | null;
  ua: string | null;
}): string {
  return sha256(
    [
      "employee",
      params.documentHash,
      params.managerSignatureHash,
      params.signatureText.trim(),
      params.signedAt,
      params.ip || "",
      params.ua || "",
    ].join(DELIMITER),
  );
}
