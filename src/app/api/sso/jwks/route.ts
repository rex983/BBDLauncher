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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("JWKS endpoint failed:", message);
    return NextResponse.json(
      { error: "JWKS not available.", detail: message },
      { status: 503 }
    );
  }
}
