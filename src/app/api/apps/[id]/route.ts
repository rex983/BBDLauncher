import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageContent } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), {
    message: "URL must start with http:// or https://",
  });

const appUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  url: httpUrl.optional(),
  icon_url: z.string().nullable().optional(),
  sso_type: z.enum(["none", "saml", "oauth", "direct_link", "jwt"]).optional(),
  status: z.enum(["active", "inactive", "maintenance"]).optional(),
  display_order: z.number().optional(),
  open_in_new_tab: z.boolean().optional(),
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  const { data: app } = await supabase
    .from("launcher_apps")
    .select("*")
    .eq("id", id)
    .single();

  if (!app) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(app);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !canManageContent(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = appUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { roles, sso_config, ...appData } = parsed.data;
  const supabase = createAdminClient();

  const { data: app, error } = await supabase
    .from("launcher_apps")
    .update(appData)
    .eq("id", id)
    .select()
    .single();

  if (error || !app) {
    return NextResponse.json({ error: error?.message || "Failed to update" }, { status: 500 });
  }

  // Update role access
  if (roles !== undefined) {
    await supabase.from("launcher_role_app_access").delete().eq("app_id", id);
    if (roles.length) {
      await supabase.from("launcher_role_app_access").insert(
        roles.map((role_name: string) => ({ role_name, app_id: id }))
      );
    }
  }

  // Update SSO config
  if (sso_config !== undefined) {
    await supabase.from("launcher_sso_configs").delete().eq("app_id", id);
    if (sso_config && (appData.sso_type === "saml" || appData.sso_type === "oauth" || appData.sso_type === "jwt")) {
      await supabase.from("launcher_sso_configs").insert({
        app_id: id,
        ...sso_config,
      });
    }
  }

  return NextResponse.json(app);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !canManageContent(session.user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = createAdminClient();

  const { error } = await supabase.from("launcher_apps").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
