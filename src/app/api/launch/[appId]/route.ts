import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSamlAssertion, generateAutoSubmitForm } from "@/lib/saml/idp";
import { generateSsoToken } from "@/lib/sso/jwt-issuer";
import { rowsAllow } from "@/lib/launcher/access";
import { hasPersonalAppGrant } from "@/lib/launcher/user-access";
import { isClockedIn } from "@/lib/timesheets/server";
import { rateLimit } from "@/lib/rate-limit";
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

  // Active gate: an inactive user shouldn't be able to mint fresh SSO tokens
  // for downstream apps even if their launcher JWT hasn't ticked over yet.
  // The jwt callback also ejects them, but this is belt-and-suspenders in
  // case a token still has valid claims for a few seconds.
  const { data: viewer } = await supabase
    .from("profiles")
    .select("is_active")
    .eq("id", session.user.profileId)
    .single();
  if (viewer?.is_active === false) {
    return NextResponse.redirect(new URL("/login?deactivated=1", req.url));
  }

  // Clock gate: admins bypass so they can debug apps outside work hours.
  // Everyone else must be clocked in — refusing to mint SSO tokens ensures
  // downstream apps can't be reached fresh while a rep is off the clock.
  if (session.user.role !== "admin") {
    const clockedIn = await isClockedIn(session.user.profileId);
    if (!clockedIn) {
      const back = new URL("/dashboard", req.url);
      back.searchParams.set("clock_required", "1");
      return NextResponse.redirect(back);
    }
  }

  // Office × role grid (migration 034): the user's role must be allowed from
  // their office. Admins still need an admin row but aren't limited by office.
  const { data: accessRows } = await supabase
    .from("launcher_role_app_access")
    .select("*")
    .eq("app_id", appId)
    .eq("role_name", session.user.role);
  const rows = ((accessRows || []) as Array<{ role_name: string; app_id: string; office?: string | null }>).map((r) => ({
    ...r,
    office: r.office ?? null,
  }));

  // People added to the app by name (migration 040) skip both office gates.
  const personal = await hasPersonalAppGrant(session.user.profileId, appId);
  if (!personal && !rowsAllow(rows, session.user.role, session.user.office, session.user.role === "admin")) {
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

  // Legacy office gate: the grid already encodes each app's office list (migration
  // 034) and saving an app's grid clears it; kept so old and new code always agree.
  const appOffices: string[] = Array.isArray(app.offices) ? app.offices : [];
  if (
    appOffices.length > 0 &&
    !personal &&
    session.user.role !== "admin" &&
    (!session.user.office || !appOffices.includes(session.user.office))
  ) {
    return NextResponse.json(
      { error: "You do not have access to this application" },
      { status: 403 }
    );
  }

  // Log the launch. Fail closed if the audit row can't be written — the
  // audit trail is the only forensic record of SSO token issuance and we'd
  // rather deny a launch than mint an untraceable token.
  const { error: auditErr } = await supabase.from("launcher_sso_audit_log").insert({
    user_id: session.user.profileId,
    app_id: appId,
    event_type: "app_launch",
    details: { sso_type: app.sso_type, app_name: app.name },
    ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
    user_agent: req.headers.get("user-agent"),
  });
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

      // Apply custom attribute mapping if configured. Whitelist which
      // session.user fields can be exposed — matches the SAML SP-initiated
      // path so a stale mapping row can't accidentally leak future claims.
      const ALLOWED_USER_FIELDS = new Set([
        "email", "name", "role", "office", "department", "is_it", "profileId",
      ]);
      if (ssoConfig.attribute_mapping) {
        const mapping = ssoConfig.attribute_mapping as Record<string, string>;
        for (const [samlAttr, userField] of Object.entries(mapping)) {
          if (!ALLOWED_USER_FIELDS.has(userField)) continue;
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

    case "jwt": {
      const { data: ssoConfig } = await supabase
        .from("launcher_sso_configs")
        .select("*")
        .eq("app_id", appId)
        .single();

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
