import { auth, signOut } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inflateRawSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";

// Single Logout.
//
// GET is the SAML HTTP-Redirect binding advertised in our IdP metadata
// (src/lib/saml/metadata.ts). It used to sign out on any GET, which let any
// page log a user out with an <img src=".../api/saml/slo">. Now a GET only
// signs out when it carries a well-formed LogoutRequest from a registered
// service provider, naming the signed-in user. Anything else is refused
// without touching the session.
//
// POST is a plain sign-out. Middleware's Origin check rejects cross-origin
// POSTs to this path, so only same-origin forms can use it.

function decodeRedirectBinding(samlRequest: string): string | null {
  const raw = Buffer.from(samlRequest, "base64");
  if (raw.length === 0) return null;
  try {
    // Redirect binding: raw DEFLATE, then base64.
    return inflateRawSync(raw).toString("utf-8");
  } catch {
    // Some SPs skip the deflate step; accept plain base64 XML too.
    const text = raw.toString("utf-8");
    return text.trimStart().startsWith("<") ? text : null;
  }
}

export async function GET(req: NextRequest) {
  const samlRequest = req.nextUrl.searchParams.get("SAMLRequest");
  if (!samlRequest) {
    return NextResponse.json({ error: "Missing SAMLRequest" }, { status: 400 });
  }

  const xml = decodeRedirectBinding(samlRequest);
  if (!xml || !/<(?:\w+:)?LogoutRequest[\s>]/.test(xml)) {
    return NextResponse.json({ error: "Invalid SAMLRequest" }, { status: 400 });
  }

  const issuer = xml
    .match(/<(?:\w+:)?Issuer[^>]*>([^<]+)<\/(?:\w+:)?Issuer>/)?.[1]
    ?.trim();
  const nameId = xml
    .match(/<(?:\w+:)?NameID[^>]*>([^<]+)<\/(?:\w+:)?NameID>/)?.[1]
    ?.trim();
  if (!issuer || !nameId) {
    return NextResponse.json({ error: "Invalid SAMLRequest" }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user) {
    // Already signed out — nothing to do.
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const { data: ssoConfig } = await createAdminClient()
    .from("launcher_sso_configs")
    .select("app_id")
    .eq("sp_entity_id", issuer)
    .maybeSingle();
  if (!ssoConfig) {
    return NextResponse.json({ error: "Unknown Service Provider" }, { status: 403 });
  }

  // The LogoutRequest must be for the person whose browser this is. Our
  // assertions use the email as NameID (see /api/saml/sso).
  if (nameId.toLowerCase() !== (session.user.email ?? "").toLowerCase()) {
    return NextResponse.json({ error: "LogoutRequest subject mismatch" }, { status: 403 });
  }

  await signOut({ redirect: false });
  return NextResponse.redirect(new URL("/login", req.url));
}

export async function POST(req: NextRequest) {
  await signOut({ redirect: false });
  return NextResponse.redirect(new URL("/login", req.url));
}
