// Shared primitives for the SHA-256 evidence chains used by incidents +
// memos. Both features hash a document + a chain of typed-name signatures,
// so the raw sha256() call and the delimiter live here to keep behavior
// bit-identical across systems.

import { createHash } from "crypto";

export const HASH_DELIMITER = "|";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
