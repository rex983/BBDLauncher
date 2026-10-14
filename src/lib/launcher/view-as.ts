import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Who may "View as" whom (migration 052, the same rule every app's launcher
// kit checks): admins → any other active person; managers (permission role
// senior_manager / junior_manager) → active people below them in their
// office (a BST manager: every office); nobody else.

/** May `viewerId` View as `targetId`? `undefined` = the check failed. */
export async function canViewAs(viewerId: string, targetId: string): Promise<boolean | undefined> {
  try {
    const { data, error } = await createAdminClient().rpc("launcher_can_view_as", {
      p_viewer: viewerId,
      p_target: targetId,
    });
    if (error) {
      console.warn(`[view-as] launcher_can_view_as failed (${error.code})`);
      return undefined;
    }
    return data === true;
  } catch (e) {
    console.warn(`[view-as] launcher_can_view_as threw: ${String(e)}`);
    return undefined;
  }
}

/** Profile ids `viewerId` may View as. Empty if the check fails (fail closed). */
export async function viewAsTargets(viewerId: string): Promise<Set<string>> {
  try {
    const { data, error } = await createAdminClient().rpc("launcher_view_as_targets", {
      p_viewer: viewerId,
    });
    if (error) {
      console.warn(`[view-as] launcher_view_as_targets failed (${error.code})`);
      return new Set();
    }
    return new Set(
      ((data ?? []) as unknown[])
        .map((r) =>
          typeof r === "string"
            ? r
            : String((r as Record<string, unknown> | null)?.launcher_view_as_targets ?? ""),
        )
        .filter(Boolean),
    );
  } catch (e) {
    console.warn(`[view-as] launcher_view_as_targets threw: ${String(e)}`);
    return new Set();
  }
}
