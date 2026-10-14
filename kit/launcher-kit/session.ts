import { adminClient } from "./config";
import { canViewAs, checkLauncherAccess, resolvePermissionRole } from "./access";
import type { LauncherActor } from "./verifier";
import type { SignInError } from "./sign-in-errors";

// Sign-in checks and the session recheck every app runs, so the launcher is
// the source of truth for who may use the app and with what role.
// Each app's auth.ts calls these and copies the results onto its token.
//
// All times here are milliseconds since the epoch; convert if the app's
// token stores seconds. A common pattern: in the NextAuth signIn callback,
// call launcherSignIn and attach the result to the `user` object, then copy
// it onto the token in the jwt callback (works without a DB adapter, where
// both callbacks see the same object).

/** How often a session is rechecked against the launcher. */
export const RECHECK_INTERVAL_MS = 60_000;
/** A session survives the launcher being unreachable for at most this long. */
export const ACCESS_GRACE_MS = 5 * 60_000;
/** A "View as" session ends this long after it started. */
export const VIEW_AS_MAX_MS = 60 * 60_000;

/** The launcher profile fields apps use. */
export interface LauncherProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  office: string | null;
  department: string | null;
  is_it: boolean;
  is_active: boolean;
  signed_out_at: string | null;
  session_version: number | null;
}

/** Stored on the token/session while an admin views the app as someone. */
export interface ViewAs {
  actorProfileId: string;
  actorEmail: string;
  actorName: string;
  /** ms since epoch */
  startedAt: number;
}

const PROFILE_COLUMNS =
  "id, email, full_name, role, office, department, is_it, is_active, signed_out_at, session_version";

function toProfile(row: Record<string, unknown>): LauncherProfile {
  return {
    id: String(row.id),
    email: String(row.email ?? ""),
    full_name: (row.full_name as string | null) ?? null,
    role: (row.role as string | null) ?? "",
    office: (row.office as string | null) ?? null,
    department: (row.department as string | null) ?? null,
    is_it: row.is_it === true,
    is_active: row.is_active !== false,
    signed_out_at: (row.signed_out_at as string | null) ?? null,
    session_version: typeof row.session_version === "number" ? row.session_version : null,
  };
}

/** Read a profile by id or email. `undefined` = read failed (transient). */
export async function readLauncherProfile(
  by: { id: string } | { email: string },
): Promise<LauncherProfile | null | undefined> {
  let q = adminClient().from("profiles").select(PROFILE_COLUMNS);
  q = "id" in by ? q.eq("id", by.id) : q.ilike("email", by.email.replace(/([\\%_])/g, "\\$1"));
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) {
    console.warn(`[launcher-kit] profile read failed (${error.code})`);
    return undefined;
  }
  return data ? toProfile(data as Record<string, unknown>) : null;
}

export type SignInResult =
  | { ok: true; profile: LauncherProfile; permRole: string; viewAs: ViewAs | null }
  | { ok: false; error: SignInError };

/**
 * Everything that decides whether someone may sign in, for every provider
 * (launcher token, Google, password). Fail-closed: anything the launcher
 * can't confirm is refused. Pass `act` from a launcher token to start a
 * read-only "View as" session.
 */
export async function launcherSignIn(
  who: { id: string } | { email: string },
  act?: LauncherActor | null,
): Promise<SignInResult> {
  const profile = await readLauncherProfile(who);
  if (profile === undefined) return { ok: false, error: "LauncherUnavailable" };
  if (!profile) return { ok: false, error: "NoProfile" };
  if (!profile.is_active) return { ok: false, error: "Inactive" };

  const [access, permRole, actor, allowedViewer] = await Promise.all([
    checkLauncherAccess(profile.id),
    resolvePermissionRole(profile.role),
    act ? readLauncherProfile({ id: act.profile_id }) : Promise.resolve(null),
    act ? canViewAs(act.profile_id, profile.id) : Promise.resolve(false),
  ]);
  if (access === "unavailable") return { ok: false, error: "LauncherUnavailable" };
  if (access !== "allowed") return { ok: false, error: "NoAppAccess" };

  let viewAs: ViewAs | null = null;
  if (act) {
    if (actor === undefined || allowedViewer === undefined) return { ok: false, error: "LauncherUnavailable" };
    if (!actorIsValid(actor, act.sub) || !allowedViewer) return { ok: false, error: "ViewAsDenied" };
    viewAs = {
      actorProfileId: actor!.id,
      actorEmail: actor!.email,
      actorName: actor!.full_name || act.name || actor!.email,
      startedAt: Date.now(),
    };
  }
  return { ok: true, profile, permRole, viewAs };
}

// The person behind a View as: still active and still the same account.
// Whether they may view as this person is launcher_can_view_as (admins,
// and managers for people below them in their office).
function actorIsValid(actor: LauncherProfile | null | undefined, email: string): boolean {
  return !!actor && actor.is_active && actor.email.toLowerCase() === email.toLowerCase();
}

export type RecheckResult =
  /** Still allowed: copy profile + permRole onto the token, set checkedAt = accessOkAt = now. */
  | { status: "ok"; profile: LauncherProfile; permRole: string; now: number }
  /** Launcher unreachable but within the grace window: keep the token as is, retry next request. */
  | { status: "keep" }
  /** End the session (return null from the jwt callback). */
  | { status: "end"; reason: EndReason };

export type EndReason =
  | "missing"
  | "inactive"
  | "signed_out"
  | "no_access"
  | "actor_invalid"
  | "view_as_expired"
  | "unreachable";

export interface RecheckInput {
  profileId: string;
  /** ms since epoch the session was signed in (not NextAuth's re-stamped iat). */
  signedInAt: number;
  /** ms since epoch of the last successful recheck (falls back to signedInAt). */
  accessOkAt?: number | null;
  /**
   * Accepted for compatibility but not used: the permission role is always
   * re-resolved, so a changed "Permissions like" reaches open sessions too.
   */
  role?: string | null;
  permRole?: string | null;
  sessionVersion?: number | null;
  viewAs?: ViewAs | null;
}

/** True once a View as session is past VIEW_AS_MAX_MS. Cheap: call it on every request. */
export function viewAsExpired(viewAs: ViewAs | null | undefined, now = Date.now()): boolean {
  return !!viewAs && now - viewAs.startedAt > VIEW_AS_MAX_MS;
}

/** True when the token's last check is older than RECHECK_INTERVAL_MS. */
export function recheckDue(checkedAt: number | null | undefined, now = Date.now()): boolean {
  return !checkedAt || now - checkedAt >= RECHECK_INTERVAL_MS;
}

/**
 * The 60s recheck: is the person (and, for View as, the admin behind it)
 * still active, still allowed into this app, and what are their current
 * role/office/department/permission role?
 */
export async function recheckLauncherSession(input: RecheckInput): Promise<RecheckResult> {
  const now = Date.now();
  if (viewAsExpired(input.viewAs, now)) {
    return { status: "end", reason: "view_as_expired" };
  }

  const [profile, access, actor, allowedViewer] = await Promise.all([
    readLauncherProfile({ id: input.profileId }),
    checkLauncherAccess(input.profileId),
    input.viewAs ? readLauncherProfile({ id: input.viewAs.actorProfileId }) : Promise.resolve(null),
    input.viewAs ? canViewAs(input.viewAs.actorProfileId, input.profileId) : Promise.resolve(true),
  ]);

  const transient =
    profile === undefined || access === "unavailable" || actor === undefined || allowedViewer === undefined;

  if (profile === null) return { status: "end", reason: "missing" };
  if (profile && !profile.is_active) return { status: "end", reason: "inactive" };
  if (profile?.signed_out_at && Date.parse(profile.signed_out_at) > input.signedInAt) {
    return { status: "end", reason: "signed_out" };
  }
  if (
    profile &&
    typeof input.sessionVersion === "number" &&
    typeof profile.session_version === "number" &&
    profile.session_version !== input.sessionVersion
  ) {
    return { status: "end", reason: "signed_out" };
  }
  if (access === "denied" || access === "unregistered") return { status: "end", reason: "no_access" };
  if (
    input.viewAs &&
    ((actor !== undefined && !actorIsValid(actor, input.viewAs.actorEmail)) || allowedViewer === false)
  ) {
    return { status: "end", reason: "actor_invalid" };
  }

  if (transient || !profile) {
    const lastOk = input.accessOkAt ?? input.signedInAt;
    return now - lastOk > ACCESS_GRACE_MS ? { status: "end", reason: "unreachable" } : { status: "keep" };
  }

  const permRole = await resolvePermissionRole(profile.role);
  return { status: "ok", profile, permRole, now };
}
