"use client";

import { useSession } from "next-auth/react";
import { Eye } from "lucide-react";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";

// Sits at the top of every /dashboard-layout page so a preview is impossible
// to lose visually. Also gives users an Exit button on non-dashboard pages
// (the sidebar has one too, but this is always in the main flow of view).
export function PreviewBanner() {
  const { data: session } = useSession();
  const { viewAs, viewAsOffice, exitPreview } = useRolePreview();

  const actualRole = session?.user?.role;
  const isAdmin = actualRole === "admin";
  const previewingRole = isAdmin && viewAs && viewAs !== actualRole;
  const previewingOffice = isAdmin && !!viewAsOffice;

  if (!previewingRole && !previewingOffice) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <Eye className="h-4 w-4" />
      <span>
        Preview mode:
        {previewingRole && (
          <>
            {" "}role <span className="font-medium">{viewAs}</span>
          </>
        )}
        {previewingRole && previewingOffice && " · "}
        {previewingOffice && (
          <>
            office <span className="font-medium">{viewAsOffice}</span>
          </>
        )}
      </span>
      <button
        type="button"
        onClick={exitPreview}
        className="ml-auto rounded-md bg-amber-900 px-3 py-1 text-xs font-medium text-amber-50 hover:bg-amber-800 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
      >
        Exit preview
      </button>
    </div>
  );
}
