import { NextResponse } from "next/server";

export async function POST() {
  // SAML SP assertion consumer is not implemented.
  // Do NOT accept unvalidated SAML responses — this endpoint must remain
  // disabled until full signature verification is in place.
  return NextResponse.json(
    { error: "SAML SP mode is not implemented" },
    { status: 501 }
  );
}
