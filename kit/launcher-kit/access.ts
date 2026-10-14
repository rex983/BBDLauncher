import { adminClient, APP_AUDIENCE } from "./config";

// The launcher's access rule and permission roles, asked of the shared DB
// (launcher migrations 049 and 051).

const MISSING_FN = new Set(["PGRST202", "42883", "PGRST204"]);

const warned = new Set<string>();
function warnOnce(key: string, msg: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[launcher-kit] ${msg}`);
}

/**
 * allowed      launcher_can_open_app returned exactly true
 * denied       false
 * unregistered NULL: no active launcher app has this app's audience
 * unavailable  function missing or a transient error; answer unknown
 * Access is fail-closed: only "allowed" lets anyone in.
 */
export type LauncherAccess = "allowed" | "denied" | "unregistered" | "unavailable";

export async function checkLauncherAccess(profileId: string): Promise<LauncherAccess> {
  try {
    const { data, error } = await adminClient().rpc("launcher_can_open_app", {
      p_profile_id: profileId,
      p_audience: APP_AUDIENCE,
    });
    if (error) {
      if (MISSING_FN.has(error.code ?? "")) warnOnce("can-open", "launcher_can_open_app is missing");
      else console.warn(`[launcher-kit] launcher_can_open_app failed (${error.code})`);
      return "unavailable";
    }
    if (data === null || data === undefined) {
      warnOnce("unregistered", `no active launcher app has audience "${APP_AUDIENCE}"`);
      return "unregistered";
    }
    return data === true ? "allowed" : "denied";
  } catch (e) {
    console.warn(`[launcher-kit] launcher_can_open_app threw: ${String(e)}`);
    return "unavailable";
  }
}

/**
 * The role whose in-app permissions this launcher role carries:
 * launcher_roles.acts_as ("Permissions like") or the role itself. Falls back
 * to the raw role if the function is missing or fails; a raw custom role
 * matches no built-in check, so that is least privilege. Never "admin"
 * unless the role really is admin.
 */
export async function resolvePermissionRole(role: string | null | undefined): Promise<string> {
  const raw = (role ?? "").trim();
  if (!raw) return "";
  let perm = raw;
  try {
    const { data, error } = await adminClient().rpc("launcher_permission_role", { p_role: raw });
    if (error) {
      if (MISSING_FN.has(error.code ?? "")) warnOnce("perm", "launcher_permission_role is missing; using raw role");
      else console.warn(`[launcher-kit] launcher_permission_role failed (${error.code}); using raw role`);
    } else if (typeof data === "string" && data) {
      perm = data;
    }
  } catch (e) {
    console.warn(`[launcher-kit] launcher_permission_role threw; using raw role: ${String(e)}`);
  }
  return perm === "admin" && raw !== "admin" ? raw : perm;
}

/**
 * Profile ids of everyone who may open this app. Empty if the launcher can't
 * answer (fail-closed), so callers never widen access on an error.
 */
export async function launcherAppMembers(): Promise<Set<string>> {
  try {
    const { data, error } = await adminClient().rpc("launcher_app_members", { p_audience: APP_AUDIENCE });
    if (error) {
      console.warn(`[launcher-kit] launcher_app_members failed (${error.code})`);
      return new Set();
    }
    return new Set(
      ((data ?? []) as unknown[]).map((r) =>
        typeof r === "string" ? r : String((r as Record<string, unknown>)?.launcher_app_members ?? ""),
      ).filter(Boolean),
    );
  } catch (e) {
    console.warn(`[launcher-kit] launcher_app_members threw: ${String(e)}`);
    return new Set();
  }
}
