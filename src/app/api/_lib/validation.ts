import { NextResponse } from "next/server";
import type { z } from "zod";

// 400 for a failed zod parse. `error` is a readable sentence, because every
// form shows `body.error` when it's a string (and a vague "Failed to save"
// when it isn't). The full breakdown stays available as `issues`.
export function validationError(error: z.ZodError) {
  const first = error.issues[0];
  const field = first?.path.length ? first.path.join(".").replace(/_/g, " ") : "";
  const message = first ? (field ? `${field}: ${first.message}` : first.message) : "Invalid request";
  return NextResponse.json({ error: message, issues: error.flatten() }, { status: 400 });
}
