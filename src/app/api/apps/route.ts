import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const appSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  url: z.string().url(),
  icon_url: z.string().nullable().optional(),
  sso_type: z.enum(["none", "saml", "oauth", "direct_link"]).default("none"),
  status: z.enum(["active", "inactive", "maintenance"]).default("active"),
  display_order: z.number().default(0),
  open_in_new_tab: z.boolean().default(true),
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
    })
    .nullable()
    .optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const supabase = createAdminClient();

  // Check if audit log is requested
  const audit = req.nextUrl.searchParams.get("audit");
  if (audit === "true") {
    const { data: auditData } = await supabase
      .from("launcher_sso_audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    return NextResponse.json({ audit: auditData || [] });
  }

  const { data: apps } = await supabase
    .from("launcher_apps")
    .select("*")
    .order("display_order", { ascending: true });

  // Fetch role access for each app
  const { data: allAccess } = await supabase
    .from("launcher_role_app_access")
    .select("*");

  // Fetch SSO configs
  const { data: ssoConfigs } = await supabase
    .from("launcher_sso_configs")
    .select("*");

  const appsWithAccess = (apps || []).map((app) => ({
    ...app,
    roles: (allAccess || [])
      .filter((a) => a.app_id === app.id)
      .map((a) => a.role_name),
    sso_config: (ssoConfigs || []).find((c) => c.app_id === app.id) || null,
  }));

  return NextResponse.json(appsWithAccess);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
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
    await supabase.from("launcher_role_app_access").insert(
      roles.map((role_name) => ({ role_name, app_id: app.id }))
    );
  }

  // Set SSO config
  if (sso_config && (appData.sso_type === "saml" || appData.sso_type === "oauth")) {
    await supabase.from("launcher_sso_configs").insert({
      app_id: app.id,
      ...sso_config,
    });
  }

  return NextResponse.json(app, { status: 201 });
}
