import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  // SP mode: receive SAML assertions from external IdPs
  // This would be used if BBD Launcher needs to accept SAML from another IdP
  const formData = await req.formData();
  const samlResponse = formData.get("SAMLResponse") as string;

  if (!samlResponse) {
    return NextResponse.json(
      { error: "Missing SAMLResponse" },
      { status: 400 }
    );
  }

  // TODO: Validate the assertion using the SP validator
  // For now, redirect to dashboard
  return NextResponse.redirect(new URL("/dashboard", req.url));
}
