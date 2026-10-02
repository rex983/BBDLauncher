import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSamlAssertion, generateAutoSubmitForm } from "@/lib/saml/idp";
import { generateSsoToken } from "@/lib/sso/jwt-issuer";
import { checkAppLaunch } from "@/lib/launcher/launch-gate";
import { rateLimit } from "@/lib/rate-limit";
import { applyAttributeMapping } from "@/app/api/_lib/saml-attributes";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const { appId } = await params;

  // Cap SSO token minting per user+app. Well above normal use (a rep won't
  // legitimately launch the same app 30x/min) but low enough to blunt token
  // flooding or audit-log spam from a compromised account.
  const rl = rateLimit(`launch:${session.user.profileId}:${appId}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many launch requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }
  const supabase = createAdminClient();

  const gate = await checkAppLaunch(supabase, session, appId);
  if (!gate.ok) {
    switch (gate.reason) {
      case "deactivated":
        return NextResponse.redirect(new URL("/login?deactivated=1", req.url));
      case "clock_required": {
        // Refusing to mint tokens keeps downstream apps out of reach while a
        // rep is off the clock.
        const back = new URL("/dashboard", req.url);
        back.searchParams.set("clock_required", "1");
        return NextResponse.redirect(back);
      }
      case "forbidden":
        return NextResponse.json(
          { error: "You do not have access to this application" },
          { status: 403 }
        );
      case "not_found":
        return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }
  }
  const { app } = gate;

  // Log the launch. Fail closed if the audit row can't be written — the
  // audit trail is the only forensic record of SSO token issuance and we'd
  // rather deny a launch than mint an untraceable token. The sign-on config
  // (only needed for saml/jwt/oauth) is read alongside; it isn't used
  // unless the audit write succeeds.
  const needsConfig =
    app.sso_type === "saml" || app.sso_type === "jwt" || app.sso_type === "oauth";
  const [{ error: auditErr }, configRes] = await Promise.all([
    supabase.from("launcher_sso_audit_log").insert({
      user_id: session.user.profileId,
      app_id: appId,
      event_type: "app_launch",
      details: { sso_type: app.sso_type, app_name: app.name },
      ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
      user_agent: req.headers.get("user-agent"),
    }),
    needsConfig
      ? supabase
          .from("launcher_sso_configs")
          .select(
            "acs_url, sp_entity_id, name_id_format, attribute_mapping, jwt_acs_url, jwt_audience, oauth_authorize_url, oauth_client_id",
          )
          .eq("app_id", appId)
          .single()
      : null,
  ]);
  const ssoConfig = configRes?.data;
  if (auditErr) {
    console.error("Audit log insert failed:", {
      code: auditErr.code,
      message: auditErr.message,
      details: auditErr.details,
      user_id: session.user.profileId,
      app_id: appId,
    });
    return NextResponse.json(
      { error: "Launch denied: audit log unavailable" },
      { status: 500 }
    );
  }

  // Defense in depth: only redirect to http(s) destinations even if a stale
  // row in the DB has a different scheme. Schema rejects others on write.
  const safeAppUrl = /^https?:\/\//i.test(app.url) ? app.url : null;
  if (!safeAppUrl) {
    return NextResponse.json(
      { error: "Application has an invalid URL" },
      { status: 500 }
    );
  }

  // Route by SSO type
  switch (app.sso_type) {
    case "direct_link":
    case "none":
      return NextResponse.redirect(safeAppUrl);

    case "saml": {
      if (!ssoConfig?.acs_url || !ssoConfig?.sp_entity_id) {
        return NextResponse.json(
          { error: "SAML not configured for this application" },
          { status: 500 }
        );
      }

      // Apply custom attribute mapping (whitelisted) on top of the defaults.
      const attributes = applyAttributeMapping(
        {
          email: session.user.email!,
          name: session.user.name || "",
          role: session.user.role,
        },
        ssoConfig.attribute_mapping,
        session.user,
      );

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

    case "jwt": {
      if (!ssoConfig?.jwt_acs_url || !ssoConfig?.jwt_audience) {
        return NextResponse.json(
          { error: "JWT SSO not configured for this application" },
          { status: 500 }
        );
      }

      const token = await generateSsoToken({
        email: session.user.email!,
        name: session.user.name || "",
        role: session.user.role,
        profileId: session.user.profileId,
        audience: ssoConfig.jwt_audience,
        isIt: session.user.is_it,
        office: session.user.office,
        department: session.user.department,
      });

      const acsUrl = new URL(ssoConfig.jwt_acs_url);
      acsUrl.searchParams.set("sso_token", token);
      return NextResponse.redirect(acsUrl.toString());
    }

    case "oauth": {
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
      return NextResponse.redirect(safeAppUrl);
  }
  } catch (err) {
    console.error("Launch error:", err);
    return NextResponse.json(
      { error: "Launch failed" },
      { status: 500 }
    );
  }
}
