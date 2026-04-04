import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSamlAssertion, generateAutoSubmitForm } from "@/lib/saml/idp";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const formData = await req.formData();
  const samlRequest = formData.get("SAMLRequest") as string;
  const relayState = formData.get("RelayState") as string | null;

  if (!samlRequest) {
    return NextResponse.json({ error: "Missing SAMLRequest" }, { status: 400 });
  }

  // Decode the AuthnRequest to extract SP details
  const decoded = Buffer.from(samlRequest, "base64").toString("utf-8");

  // Extract issuer and ACS URL from the request (basic XML parsing)
  const issuerMatch = decoded.match(/<saml:Issuer[^>]*>([^<]+)<\/saml:Issuer>/);
  const acsMatch = decoded.match(/AssertionConsumerServiceURL="([^"]+)"/);
  const idMatch = decoded.match(/ID="([^"]+)"/);

  if (!issuerMatch || !acsMatch) {
    return NextResponse.json(
      { error: "Invalid SAMLRequest" },
      { status: 400 }
    );
  }

  const spEntityId = issuerMatch[1];
  const requestedAcsUrl = acsMatch[1];
  const requestId = idMatch?.[1];

  // Verify the SP is configured
  const supabase = createAdminClient();
  const { data: ssoConfig } = await supabase
    .from("launcher_sso_configs")
    .select("*, launcher_apps!inner(id, name)")
    .eq("sp_entity_id", spEntityId)
    .single();

  if (!ssoConfig) {
    return NextResponse.json(
      { error: "Unknown Service Provider" },
      { status: 403 }
    );
  }

  // SECURITY: Always use the registered ACS URL from our database, not the one
  // from the incoming request. An attacker could spoof the ACS URL to redirect
  // the signed assertion to their own server.
  const trustedAcsUrl = ssoConfig.acs_url;
  if (!trustedAcsUrl) {
    return NextResponse.json(
      { error: "ACS URL not configured for this SP" },
      { status: 500 }
    );
  }

  if (requestedAcsUrl !== trustedAcsUrl) {
    console.warn(
      `SAML ACS URL mismatch: SP "${spEntityId}" requested "${requestedAcsUrl}" but registered URL is "${trustedAcsUrl}"`
    );
  }

  // Build attributes from mapping
  const attributes: Record<string, string> = {};
  if (ssoConfig.attribute_mapping) {
    const mapping = ssoConfig.attribute_mapping as Record<string, string>;
    for (const [samlAttr, userField] of Object.entries(mapping)) {
      const value = (session.user as Record<string, unknown>)[userField];
      if (value) attributes[samlAttr] = String(value);
    }
  }

  // Generate assertion — use trusted ACS URL
  const samlResponse = generateSamlAssertion({
    nameId: session.user.email!,
    nameIdFormat: ssoConfig.name_id_format,
    audience: spEntityId,
    acsUrl: trustedAcsUrl,
    inResponseTo: requestId,
    attributes,
  });

  // Log the SSO event
  await supabase.from("launcher_sso_audit_log").insert({
    user_id: session.user.profileId,
    app_id: ssoConfig.app_id,
    event_type: "saml_assertion_issued",
    details: { sp_entity_id: spEntityId },
    ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
    user_agent: req.headers.get("user-agent"),
  });

  // Return auto-submit form — use trusted ACS URL
  const html = generateAutoSubmitForm(trustedAcsUrl, samlResponse, relayState || undefined);
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}
