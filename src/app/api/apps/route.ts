import { createAdminClient } from "@/lib/supabase/admin";
import { requireSession } from "@/lib/auth/require-session";
import { canManageContent, isAdmin } from "@/lib/auth/permissions";
import { bustLauncherCache } from "@/lib/launcher/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OFFICES } from "@/lib/org/constants";
import { ACCESS_OFFICES, cellsFromRows, officesWithAccess, rowsFromCells } from "@/lib/launcher/access";
import { setUserIds, userIdsByTarget } from "@/lib/launcher/user-access";
import { httpUrl, ssoConfigSchema } from "@/lib/launcher/app-schema";

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

    const { data: apps, error: appsError } = await supabase
      .from("launcher_apps")
      .select("*")
      .order("display_order", { ascending: true });

    if (appsError) {
      return NextResponse.json({ error: appsError.message }, { status: 500 });
    }

    const appIds = (apps || []).map((a) => a.id);

    const usersPromise = userIdsByTarget("app_id", appIds);
    // Sign-on settings (including OAuth client secrets) are admin-only.
    const viewerIsAdmin = isAdmin(session.user.role);
    const [accessRes, ssoRes] = appIds.length
      ? await Promise.all([
          supabase
            .from("launcher_role_app_access")
            .select("*")
            .in("app_id", appIds),
          viewerIsAdmin
            ? supabase.from("launcher_sso_configs").select("*").in("app_id", appIds)
            : Promise.resolve({ data: [] as { app_id: string }[] }),
        ])
      : [{ data: [] as { app_id: string; role_name: string }[] }, { data: [] as { app_id: string }[] }];
    const usersByAppId = await usersPromise;

    const rowsByAppId = new Map<string, Array<{ role_name: string; office: string | null }>>();
    for (const a of (accessRes.data || []) as Array<{ app_id: string; role_name: string; office?: string | null }>) {
      const list = rowsByAppId.get(a.app_id) ?? [];
      list.push({ role_name: a.role_name, office: a.office ?? null });
      rowsByAppId.set(a.app_id, list);
    }
    const ssoByAppId = new Map<string, unknown>();
    for (const c of ssoRes.data || []) ssoByAppId.set(c.app_id, c);

    const appsWithAccess = (apps || []).map((app) => ({
      ...app,
      roles: [...new Set((rowsByAppId.get(app.id) || []).map((r) => r.role_name))],
      access: cellsFromRows(rowsByAppId.get(app.id) || []),
      access_offices: officesWithAccess(rowsByAppId.get(app.id) || []),
      user_ids: usersByAppId.get(app.id) || [],
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
      (appData.sso_type === "saml" || appData.sso_type === "oauth" || appData.sso_type === "jwt")
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

    // Set access: the grid if sent, otherwise the older role list (every office).
    const accessRows = access
      ? rowsFromCells(app.id, access)
      : (roles || []).map((role_name) => ({ role_name, app_id: app.id, office: null }));
    if (accessRows.length) {
      const { error: roleError } = await supabase.from("launcher_role_app_access").insert(accessRows);
      if (roleError) console.error("Role access insert error:", roleError.message);
    }

    if (user_ids?.length) {
      const userError = await setUserIds("app_id", app.id, user_ids);
      if (userError) console.error("User access insert error:", userError);
    }

    // Set SSO config
    if (sso_config && (appData.sso_type === "saml" || appData.sso_type === "oauth" || appData.sso_type === "jwt")) {
      const { error: ssoError } = await supabase.from("launcher_sso_configs").insert({
        app_id: app.id,
        ...sso_config,
      });
      if (ssoError) console.error("SSO config insert error:", ssoError.message);
    }

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
