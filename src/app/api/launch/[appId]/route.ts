import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSamlAssertion, generateAutoSubmitForm } from "@/lib/saml/idp";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const { appId } = await params;
  const supabase = createAdminClient();

  // Check role access
  const { data: access } = await supabase
    .from("launcher_role_app_access")
    .select("app_id")
    .eq("app_id", appId)
    .eq("role_name", session.user.role)
    .single();

  if (!access) {
    return NextResponse.json(
      { error: "You do not have access to this application" },
      { status: 403 }
    );
  }

  // Fetch app and SSO config
  const { data: app } = await supabase
    .from("launcher_apps")
    .select("*")
    .eq("id", appId)
    .eq("status", "active")
    .single();

  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  // Log the launch
  await supabase.from("launcher_sso_audit_log").insert({
    user_id: session.user.profileId,
    app_id: appId,
    event_type: "app_launch",
    details: { sso_type: app.sso_type, app_name: app.name },
    ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
    user_agent: req.headers.get("user-agent"),
  });

  // Route by SSO type
  switch (app.sso_type) {
    case "direct_link":
    case "none":
      return NextResponse.redirect(app.url);

    case "saml": {
      const { data: ssoConfig } = await supabase
        .from("launcher_sso_configs")
        .select("*")
        .eq("app_id", appId)
        .single();

      if (!ssoConfig?.acs_url || !ssoConfig?.sp_entity_id) {
        return NextResponse.json(
          { error: "SAML not configured for this application" },
          { status: 500 }
        );
      }

      const attributes: Record<string, string> = {
        email: session.user.email!,
        name: session.user.name || "",
        role: session.user.role,
      };

      // Apply custom attribute mapping if configured
      if (ssoConfig.attribute_mapping) {
        const mapping = ssoConfig.attribute_mapping as Record<string, string>;
        for (const [samlAttr, userField] of Object.entries(mapping)) {
          const value = (session.user as Record<string, unknown>)[userField];
          if (value) attributes[samlAttr] = String(value);
        }
      }

      const samlResponse = generateSamlAssertion({
        nameId: session.user.email!,
        nameIdFormat: ssoConfig.name_id_format,
        audience: ssoConfig.sp_entity_id,
        acsUrl: ssoConfig.acs_url,
        attributes,
      });

      const html = generateAutoSubmitForm(ssoConfig.acs_url, samlResponse);
      return new NextResponse(html, {
        headers: { "Content-Type": "text/html" },
      });
    }

    case "oauth": {
      const { data: ssoConfig } = await supabase
        .from("launcher_sso_configs")
        .select("*")
        .eq("app_id", appId)
        .single();

      if (!ssoConfig?.oauth_authorize_url || !ssoConfig?.oauth_client_id) {
        return NextResponse.json(
          { error: "OAuth not configured for this application" },
          { status: 500 }
        );
      }

      const authUrl = new URL(ssoConfig.oauth_authorize_url);
      authUrl.searchParams.set("client_id", ssoConfig.oauth_client_id);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set(
        "redirect_uri",
        `${process.env.AUTH_URL}/api/oauth/callback/${appId}`
      );
      authUrl.searchParams.set("scope", "openid email profile");

      return NextResponse.redirect(authUrl.toString());
    }

    default:
      return NextResponse.redirect(app.url);
  }
}
