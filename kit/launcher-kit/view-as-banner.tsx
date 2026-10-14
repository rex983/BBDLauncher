"use client";

import { signOut } from "next-auth/react";
import { LAUNCHER_DASHBOARD_URL } from "./urls";

// Fixed banner for a launcher "View as" session. Render it in the
// authenticated layout when session.viewAs is set.

export function ViewAsBanner({
  viewedName,
  viewedRole,
  actorName,
  exitUrl = LAUNCHER_DASHBOARD_URL,
}: {
  viewedName: string;
  viewedRole?: string | null;
  actorName: string;
  /** Where Exit goes after signing out (default: the launcher dashboard). */
  exitUrl?: string;
}) {
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[100] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-400 px-4 py-2 text-sm font-medium text-amber-950 shadow-lg"
    >
      <span>
        Viewing as <strong>{viewedName}</strong>
        {viewedRole ? ` (${viewedRole})` : ""} — read-only. Signed in as {actorName}.
      </span>
      <button
        type="button"
        onClick={() => signOut({ redirectTo: exitUrl })}
        className="rounded-md bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900"
      >
        Exit
      </button>
    </div>
  );
}
