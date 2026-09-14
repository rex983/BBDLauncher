import { auth } from "@/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canEditTimeData,
  canViewTimeData,
  timeDataScope,
  type TimeDataScope,
} from "@/lib/auth/permissions";
import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import type { SupabaseClient } from "@supabase/supabase-js";

type Need = "view" | "edit";

interface OkBase {
  ok: true;
  session: Session;
  supabase: SupabaseClient;
  scope: TimeDataScope & { allowed: true };
}
interface Fail {
  ok: false;
  response: NextResponse;
}
type OkWithTarget<T> = OkBase & { target: T };
export type ScopeGate = OkBase | Fail;
export type ScopeGateWithTarget<T> = OkWithTarget<T> | Fail;

// Gate a request against the time-data authz stack in one call:
//   1. session exists
//   2. role has view/edit permission
//   3. viewer has a valid (department, office) scope
//   4. (optional) target profile is active AND falls within both scope axes
//
// Pass null for targetProfileId when the route touches a list, not a specific
// employee — the target check is skipped.
export async function requireTimeDataAccess(
  targetProfileId: string | null,
  need: Need,
): Promise<ScopeGate> {
  const base = await enterScope(need);
  if (!base.ok) return base;

  if (targetProfileId && (base.scope.department || base.scope.office)) {
    const { data } = await base.supabase
      .from("profiles")
      .select("department, office, is_active")
      .eq("id", targetProfileId)
      .single();
    if (!data) return outOfScope();
    if (data.is_active === false) return outOfScope();
    if (base.scope.department && data.department !== base.scope.department) return outOfScope();
    if (base.scope.office && data.office !== base.scope.office) return outOfScope();
  }

  return base;
}

// Same as requireTimeDataAccess but fetches the target profile with the given
// columns AND enforces scope on the returned row — one query, not two.
// `selectColumns` must include `department`, `office`, and `is_active`.
export async function requireTimeDataAccessWithProfile<
  T extends { department: string | null; office: string | null; is_active: boolean },
>(
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
  if (!target) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }
  if (target.is_active === false) return outOfScope();
  if (base.scope.department && target.department !== base.scope.department) {
    return outOfScope();
  }
  if (base.scope.office && target.office !== base.scope.office) {
    return outOfScope();
  }

  return { ...base, target };
}

async function enterScope(need: Need): Promise<ScopeGate> {
  const session = await auth();
  const permit = need === "edit" ? canEditTimeData : canViewTimeData;
  if (!session?.user || !permit(session.user.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 403 }),
    };
  }

  const scope = timeDataScope(
    session.user.role,
    session.user.department,
    session.user.office,
  );
  if (!scope.allowed) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No scope" }, { status: 403 }),
    };
  }

  return { ok: true, session, supabase: createAdminClient(), scope };
}

function outOfScope(): Fail {
  return {
    ok: false,
    response: NextResponse.json({ error: "Out of scope" }, { status: 403 }),
  };
}
