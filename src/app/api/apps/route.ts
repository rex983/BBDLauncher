import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import { canManageContent, isAdmin } from "@/lib/auth/permissions";
import { bustLauncherCache } from "@/lib/launcher/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OFFICES } from "@/lib/org/constants";
import { ACCESS_OFFICES, rowsFromCells } from "@/lib/launcher/access";
import { loadAdminApps } from "@/lib/launcher/admin-apps";
import { setUserIds } from "@/lib/launcher/user-access";
import { httpUrl, ssoConfigSchema } from "@/lib/launcher/app-schema";

const appSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  url: httpUrl,
  icon_url: z.string().nullable().optional(),
  sso_type: z.enum(["none", "saml", "direct_link", "jwt"]).default("none"),
  status: z.enum(["active", "inactive", "maintenance"]).default("active"),
  display_order: z.number().default(0),
  open_in_new_tab: z.boolean().default(true),
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

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession(canManageContent);
    if (session instanceof NextResponse) return session;

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

    // Sign-on settings are admin-only.
    const { data: appsWithAccess, error: appsError } = await loadAdminApps(
      isAdmin(session.user.role),
    );
    if (appsError) {
      return NextResponse.json({ error: appsError }, { status: 500 });
    }

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
    const session = await requireSession(canManageContent);
    if (session instanceof NextResponse) return session;

    const body = await req.json();
    const parsed = appSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { roles, access, user_ids, sso_config, ...appData } = parsed.data;
    // Single sign-on decides where launch tokens get sent — admins only.
    if (
      !isAdmin(session.user.role) &&
      (appData.sso_type === "saml" || appData.sso_type === "jwt")
    ) {
      return NextResponse.json({ error: "Only admins can set up single sign-on." }, { status: 403 });
    }
    // The grid holds office limits now; the app's own office list stays empty.
    if (access) appData.offices = [];
    const supabase = createAdminClient();

    const { data: app, error } = await supabase
      .from("launcher_apps")
      .insert(appData)
      .select()
      .single();

    if (error || !app) {
      return NextResponse.json({ error: error?.message || "Failed to create app" }, { status: 500 });
    }

    // Access grid (or the older role list, every office), people, and SSO
    // config are independent child rows — write them together. Failures are
    // logged, not returned: the app itself already exists.
    const accessRows = access
      ? rowsFromCells(app.id, access)
      : (roles || []).map((role_name) => ({ role_name, app_id: app.id, office: null }));
    await Promise.all([
      accessRows.length > 0 &&
        supabase
          .from("launcher_role_app_access")
          .insert(accessRows)
          .then(({ error: roleError }) => {
            if (roleError) console.error("Role access insert error:", roleError.message);
          }),
      user_ids?.length &&
        setUserIds("app_id", app.id, user_ids).then((userError) => {
          if (userError) console.error("User access insert error:", userError);
        }),
      sso_config &&
        (appData.sso_type === "saml" || appData.sso_type === "jwt") &&
        supabase
          .from("launcher_sso_configs")
          .insert({ app_id: app.id, ...sso_config })
          .then(({ error: ssoError }) => {
            if (ssoError) console.error("SSO config insert error:", ssoError.message);
          }),
    ]);

    bustLauncherCache("apps");
    return NextResponse.json(app, { status: 201 });
  } catch (err) {
    console.error("POST /api/apps error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
