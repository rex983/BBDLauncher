import { getPublicJwk } from "@/lib/sso/jwt-issuer";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const jwk = await getPublicJwk();
    return NextResponse.json(
      { keys: [jwk] },
      {
        headers: {
          "Cache-Control": "public, max-age=3600",
        },
      }
    );
  } catch {
    return NextResponse.json(
      { error: "JWKS not available. SSO_JWT_PRIVATE_KEY may not be configured." },
      { status: 503 }
    );
  }
}
