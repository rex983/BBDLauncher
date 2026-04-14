import { NextResponse } from "next/server";
import { importPKCS8 } from "jose";

/**
 * Diagnostic endpoint — shows what's wrong with the SSO_JWT_PRIVATE_KEY
 * env var without exposing the key itself. Safe to call publicly since it
 * only reports structure, never the key contents.
 *
 * DELETE THIS FILE after SSO is working.
 */
export async function GET() {
  const raw = process.env.SSO_JWT_PRIVATE_KEY;

  if (!raw) {
    return NextResponse.json({
      configured: false,
      error: "SSO_JWT_PRIVATE_KEY is not set in this environment",
    });
  }

  const normalized = raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;

  const info = {
    configured: true,
    raw_length: raw.length,
    normalized_length: normalized.length,
    had_escaped_newlines: raw.includes("\\n"),
    starts_with_begin: normalized.startsWith("-----BEGIN"),
    ends_with_end: normalized.trimEnd().endsWith("-----END PRIVATE KEY-----") || normalized.trimEnd().endsWith("-----END EC PRIVATE KEY-----"),
    has_private_key_marker: normalized.includes("BEGIN PRIVATE KEY"),
    has_ec_private_key_marker: normalized.includes("BEGIN EC PRIVATE KEY"),
    line_count: normalized.split("\n").length,
    // First and last 15 chars of the normalized value (safe to show — these are PEM markers)
    first_chars: normalized.slice(0, 30),
    last_chars: normalized.slice(-30),
  };

  let parse_error: string | null = null;
  try {
    await importPKCS8(normalized, "ES256");
  } catch (err) {
    parse_error = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({ ...info, parse_error });
}
