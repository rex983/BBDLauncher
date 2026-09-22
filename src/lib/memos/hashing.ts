// SHA-256 evidence chain for signed-mode memos. Mirrors the incident
// hashing chain but the labels differ so a mixed-system export can tell
// which system produced which hash without additional context.
//
//   document_hash          = sha256(memo body captured at publish time)
//   author_signature_hash  = sha256("author" || pipe-separated fields)
//   recipient_signature_hash =
//       sha256("recipient" || fields, chained on author hash)

import { HASH_DELIMITER, sha256 } from "@/lib/hashing";

export function hashMemoDocument(document: string): string {
  return sha256(document.replace(/\r\n/g, "\n"));
}

export function hashAuthorSignature(params: {
  documentHash: string;
  signatureText: string;
  signedAt: string;
  ip: string | null;
  ua: string | null;
}): string {
  return sha256(
    [
      "author",
      params.documentHash,
      params.signatureText.trim(),
      params.signedAt,
      params.ip || "",
      params.ua || "",
    ].join(HASH_DELIMITER),
  );
}

export function hashRecipientSignature(params: {
  documentHash: string;
  authorSignatureHash: string;
  signatureText: string;
  signedAt: string;
  ip: string | null;
  ua: string | null;
}): string {
  return sha256(
    [
      "recipient",
      params.documentHash,
      params.authorSignatureHash,
      params.signatureText.trim(),
      params.signedAt,
      params.ip || "",
      params.ua || "",
    ].join(HASH_DELIMITER),
  );
}
