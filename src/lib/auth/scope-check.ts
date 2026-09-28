import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canEditTimeData,
  canViewTimeData,
  isAdmin,
  timeDataScope,
  type TimeDataScope,
} from "@/lib/auth/permissions";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import type { SupabaseClient } from "@supabase/supabase-js";

type Need = "view" | "edit";
export type AllowedScope = TimeDataScope & { allowed: true };

interface OkBase {
  ok: true;
  session: Session;
  supabase: SupabaseClient;
  scope: AllowedScope;
  viewerIsAdmin: boolean;
}
interface Fail {
  ok: false;
  response: NextResponse;
}
type OkWithTarget<T> = OkBase & { target: T };
type ScopeGate = OkBase | Fail;
type ScopeGateWithTarget<T> = OkWithTarget<T> | Fail;

// Framework-free failure — server components render it, route handlers wrap
// it in a NextResponse.
export interface GateFailure {
  ok: false;
  status: number;
  message: string;
}

// The (department, office, is_active) slice every scope decision reads.
export interface ScopedProfile {
  department: string | null;
  office: string | null;
  is_active: boolean;
}

type Viewer = Pick<Session["user"], "role" | "department" | "office">;

// Steps 2–3 of the gate below, without the session lookup or a response
// object, so server components can share the exact same rules.
export function resolveTimeDataScope(
  viewer: Viewer | undefined | null,
  need: Need,
): { ok: true; scope: AllowedScope; viewerIsAdmin: boolean } | GateFailure {
  const permit = need === "edit" ? canEditTimeData : canViewTimeData;
  if (!viewer || !permit(viewer.role)) {
    return { ok: false, status: 403, message: "Unauthorized" };
  }
  const scope = timeDataScope(viewer.role, viewer.department, viewer.office);
  if (!scope.allowed) return { ok: false, status: 403, message: "No scope" };
  return { ok: true, scope, viewerIsAdmin: isAdmin(viewer.role) };
}

// Non-admin rule: target must be active and inside both scope axes. Admin
// scopes have both axes null, but callers still skip this for admins so
// they can reach inactive users.
export function isTargetInScope(scope: AllowedScope, target: ScopedProfile): boolean {
  if (target.is_active === false) return false;
  if (scope.department && target.department !== scope.department) return false;
  if (scope.office && target.office !== scope.office) return false;
  return true;
}

interface EqBuilder {
  eq(column: string, value: string | boolean): EqBuilder;
}

// Narrow a `profiles` query to everyone the scope can see. Admin overrides
// only apply when the scope leaves that axis open. Takes and returns the
// caller's builder so its select-column typing and ordering survive.
// Q is left unconstrained on purpose: structurally checking a PostgREST
// builder against an `eq` signature trips TS2589 on wide selects.
export function scopeProfilesQuery<Q>(
  query: Q,
  scope: { department: string | null; office: string | null },
  {
    department,
    office,
    includeInactive = false,
  }: { department?: string | null; office?: string | null; includeInactive?: boolean } = {},
): Q {
  // PostgREST filter methods return `this`, so the builder type is kept.
  let q = query as unknown as EqBuilder;
  if (!includeInactive) q = q.eq("is_active", true);
  const dept = scope.department ?? department;
  const off = scope.office ?? office;
  if (dept) q = q.eq("department", dept);
  if (off) q = q.eq("office", off);
  return q as unknown as Q;
}

// Gate a request against the time-data authz stack in one call:
//   1. session exists
//   2. role has view/edit permission
//   3. viewer has a valid (department, office) scope
//   4. (optional) target profile falls within both scope axes AND is active
//
// Admins bypass step 4 entirely — they can view/edit anyone, including
// inactive users and themselves. Pass null for targetProfileId when the
// route touches a list, not a specific employee.
export async function requireTimeDataAccess(
  targetProfileId: string | null,
  need: Need,
): Promise<ScopeGate> {
  const base = await enterScope(need);
  if (!base.ok) return base;
  if (base.viewerIsAdmin) return base;

  if (targetProfileId && (base.scope.department || base.scope.office)) {
    const { data } = await base.supabase
      .from("profiles")
      .select("department, office, is_active")
      .eq("id", targetProfileId)
      .single<ScopedProfile>();
    if (!data || !isTargetInScope(base.scope, data)) return outOfScope();
  }

  return base;
}

// Same as requireTimeDataAccess but fetches the target profile with the given
// columns AND enforces scope on the returned row — one query, not two.
// `selectColumns` must include `department`, `office`, and `is_active`.
// Admins skip the scope+active checks but still get the target row.
export async function requireTimeDataAccessWithProfile<T extends ScopedProfile>(
  targetProfileId: string,
  need: Need,
  selectColumns: string,
): Promise<ScopeGateWithTarget<T>> {
  const base = await enterScope(need);
  if (!base.ok) return base;

  const { data: target } = await base.supabase
    .from("profiles")
    .select(selectColumns)
    .eq("id", targetProfileId)
    .single<T>();
  if (!target) return toFail({ ok: false, status: 404, message: "Not found" });
  if (!base.viewerIsAdmin && !isTargetInScope(base.scope, target)) return outOfScope();

  return { ...base, target };
}

async function enterScope(need: Need): Promise<ScopeGate> {
  const session = await auth();
  const resolved = resolveTimeDataScope(session?.user, need);
  if (!resolved.ok) return toFail(resolved);
  return {
    ok: true,
    session: session!,
    supabase: createAdminClient(),
    scope: resolved.scope,
    viewerIsAdmin: resolved.viewerIsAdmin,
  };
}

function toFail({ status, message }: GateFailure): Fail {
  return { ok: false, response: NextResponse.json({ error: message }, { status }) };
}

function outOfScope(): Fail {
  return toFail({ ok: false, status: 403, message: "Out of scope" });
}
