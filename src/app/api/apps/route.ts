import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageContent, isAdmin } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), {
    message: "URL must start with http:// or https://",
  });

const appSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  url: httpUrl,
  icon_url: z.string().nullable().optional(),
  sso_type: z.enum(["none", "saml", "oauth", "direct_link", "jwt"]).default("none"),
  status: z.enum(["active", "inactive", "maintenance"]).default("active"),
  display_order: z.number().default(0),
  open_in_new_tab: z.boolean().default(true),
  section_id: z.string().uuid().nullable().optional(),
  roles: z.array(z.string()).optional(),
  sso_config: z
    .object({
      sp_entity_id: z.string().optional(),
      acs_url: z.string().optional(),
      slo_url: z.string().optional(),
      oauth_client_id: z.string().optional(),
      oauth_client_secret: z.string().optional(),
      oauth_authorize_url: z.string().optional(),
      oauth_token_url: z.string().optional(),
      jwt_acs_url: z.string().optional(),
      jwt_audience: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || !canManageContent(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const supabase = createAdminClient();

    // Audit log includes IPs/UAs of every launch — admin-only.
    const audit = req.nextUrl.searchParams.get("audit");
    if (audit === "true") {
      if (!isAdmin(session.user.role)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const { data: auditData } = await supabase
        .from("launcher_sso_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      return NextResponse.json({ audit: auditData || [] });
    }

    const { data: apps, error: appsError } = await supabase
      .from("launcher_apps")
      .select("*")
      .order("display_order", { ascending: true });

    if (appsError) {
      return NextResponse.json({ error: appsError.message }, { status: 500 });
    }

    const appIds = (apps || []).map((a) => a.id);

    const [accessRes, ssoRes] = appIds.length
      ? await Promise.all([
          supabase
            .from("launcher_role_app_access")
            .select("*")
            .in("app_id", appIds),
          supabase
            .from("launcher_sso_configs")
            .select("*")
            .in("app_id", appIds),
        ])
      : [{ data: [] as { app_id: string; role_name: string }[] }, { data: [] as { app_id: string }[] }];

    const rolesByAppId = new Map<string, string[]>();
    for (const a of accessRes.data || []) {
      const list = rolesByAppId.get(a.app_id);
      if (list) list.push(a.role_name);
      else rolesByAppId.set(a.app_id, [a.role_name]);
    }
    const ssoByAppId = new Map<string, unknown>();
    for (const c of ssoRes.data || []) ssoByAppId.set(c.app_id, c);

    const appsWithAccess = (apps || []).map((app) => ({
      ...app,
      roles: rolesByAppId.get(app.id) || [],
      sso_config: ssoByAppId.get(app.id) || null,
    }));

    return NextResponse.json(appsWithAccess);
  } catch (err) {
    console.error("GET /api/apps error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || !canManageContent(session.user.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = appSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { roles, sso_config, ...appData } = parsed.data;
    const supabase = createAdminClient();

    const { data: app, error } = await supabase
      .from("launcher_apps")
      .insert(appData)
      .select()
      .single();

    if (error || !app) {
      return NextResponse.json({ error: error?.message || "Failed to create app" }, { status: 500 });
    }

    // Set role access
    if (roles?.length) {
      const { error: roleError } = await supabase.from("launcher_role_app_access").insert(
        roles.map((role_name) => ({ role_name, app_id: app.id }))
      );
      if (roleError) console.error("Role access insert error:", roleError.message);
    }

    // Set SSO config
    if (sso_config && (appData.sso_type === "saml" || appData.sso_type === "oauth" || appData.sso_type === "jwt")) {
      const { error: ssoError } = await supabase.from("launcher_sso_configs").insert({
        app_id: app.id,
        ...sso_config,
      });
      if (ssoError) console.error("SSO config insert error:", ssoError.message);
    }

    return NextResponse.json(app, { status: 201 });
  } catch (err) {
    console.error("POST /api/apps error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
