import { timeDataScope } from "@/lib/auth/permissions";
import type { Session } from "next-auth";

type Viewer = Pick<Session["user"], "role" | "department" | "office">;
export interface MemoPerson {
  department: string | null;
  office: string | null;
  is_active: boolean;
}

// Whose read/acknowledge status a viewer may see on a memo. Admins and the
// memo's author see every recipient (null). Other managers see only the
// active people in their own department AND office, like the rest of the
// time data; a manager missing either assignment sees no one.
export function memoTrackingScope(
  viewer: Viewer,
  isAuthor: boolean,
): ((p: MemoPerson | null | undefined) => boolean) | null {
  if (isAuthor) return null;
  const scope = timeDataScope(viewer.role, viewer.department, viewer.office);
  if (scope.allowed && !scope.department && !scope.office) return null;
  if (!scope.allowed) return () => false;
  return (p) =>
    !!p && p.is_active && p.department === scope.department && p.office === scope.office;
}
