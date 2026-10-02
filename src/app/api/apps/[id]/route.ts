import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import { canManageContent, isAdmin } from "@/lib/auth/permissions";
import { bustLauncherCache } from "@/lib/launcher/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OFFICES } from "@/lib/org/constants";
import { ACCESS_OFFICES, rowsFromCells } from "@/lib/launcher/access";
import { setUserIds } from "@/lib/launcher/user-access";
import { httpUrl, ssoConfigSchema } from "@/lib/launcher/app-schema";

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
  offices: z.array(z.enum(OFFICES)).optional(),
  roles: z.array(z.string()).optional(),
  /** Office × role grid cells that can open the app. Replaces roles + offices. */
  access: z
    .array(z.object({ role: z.string().min(1), office: z.enum(ACCESS_OFFICES) }))
    .max(500)
    .optional(),
  /** Individual people who can open the app, on top of the grid. */
  user_ids: z.array(z.string().uuid()).max(500).optional(),
  sso_config: ssoConfigSchema.nullable().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

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
  const session = await requireSession(canManageContent);
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const body = await req.json();
  const parsed = appUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { roles, access, user_ids, sso_config, ...appData } = parsed.data;
  // The grid holds office limits now; the app's own office list stays empty.
  if (access) appData.offices = [];
  // Single sign-on decides where launch tokens (which carry the launching
  // user's role) get sent, so only admins can change it.
  const viewerIsAdmin = isAdmin(session.user.role);
  if (!viewerIsAdmin) delete appData.sso_type;
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

  // Update access: the grid if sent, otherwise the older role list (every office).
  if (access !== undefined || roles !== undefined) {
    const rows = access
      ? rowsFromCells(id, access)
      : (roles || []).map((role_name: string) => ({ role_name, app_id: id, office: null }));
    const { error: delError } = await supabase.from("launcher_role_app_access").delete().eq("app_id", id);
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });
    if (rows.length) {
      const { error: insError } = await supabase.from("launcher_role_app_access").insert(rows);
      if (insError) return NextResponse.json({ error: insError.message }, { status: 500 });
    }
  }

  if (user_ids !== undefined) {
    const userError = await setUserIds("app_id", id, user_ids);
    if (userError) return NextResponse.json({ error: userError }, { status: 500 });
  }

  // Update SSO config
  if (sso_config !== undefined && viewerIsAdmin) {
    await supabase.from("launcher_sso_configs").delete().eq("app_id", id);
    if (sso_config && (appData.sso_type === "saml" || appData.sso_type === "oauth" || appData.sso_type === "jwt")) {
      await supabase.from("launcher_sso_configs").insert({
        app_id: id,
        ...sso_config,
      });
    }
  }

  bustLauncherCache("apps");
  return NextResponse.json(app);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(canManageContent);
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const supabase = createAdminClient();

  const { error } = await supabase.from("launcher_apps").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  bustLauncherCache("apps");
  return NextResponse.json({ success: true });
}
