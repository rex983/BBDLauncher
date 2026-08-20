"use client";

import { forwardRef } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { GripVertical, Star } from "lucide-react";
import type { LauncherApp } from "@/types/app";

interface AppListRowProps {
  app: LauncherApp;
  isDragging?: boolean;
  dragHandleProps?: Record<string, unknown>;
  style?: React.CSSProperties;
  isFavorite?: boolean;
  onToggleFavorite?: (appId: string) => void;
  showDragHandle?: boolean;
}

const ssoBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  saml: "default",
  oauth: "secondary",
  jwt: "default",
  direct_link: "outline",
  none: "outline",
};

export const AppListRow = forwardRef<HTMLDivElement, AppListRowProps>(
  function AppListRow(
    {
      app,
      isDragging,
      dragHandleProps,
      style,
      isFavorite,
      onToggleFavorite,
      showDragHandle = true,
    },
    ref
  ) {
    const { data: session } = useSession();
    const searchParams = useSearchParams();
    const actualRole = session?.user?.role;
    const viewAs = searchParams.get("viewAs");
    const effectiveRole = actualRole === "admin" && viewAs ? viewAs : actualRole;
    const showSsoBadge = effectiveRole === "admin";
    const firstLetter = app.name.charAt(0).toUpperCase();
    const href = `/api/launch/${app.id}`;

    return (
      <div ref={ref} style={style} className={isDragging ? "z-50" : ""}>
        <div
          className={`group flex items-center gap-3 rounded-md border bg-card px-3 py-2 transition-all hover:border-primary/50 hover:shadow-sm ${
            isDragging ? "shadow-lg ring-2 ring-primary/30 opacity-90" : ""
          }`}
        >
          {onToggleFavorite && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorite(app.id);
              }}
              aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
              className={`flex-shrink-0 transition-opacity ${
                isFavorite
                  ? "opacity-100 text-yellow-500"
                  : "opacity-30 group-hover:opacity-60 hover:!opacity-100 text-muted-foreground"
              }`}
            >
              <Star
                className="h-4 w-4"
                fill={isFavorite ? "currentColor" : "none"}
              />
            </button>
          )}
          <a
            href={href}
            target={app.open_in_new_tab ? "_blank" : "_self"}
            rel="noopener noreferrer"
            className="flex items-center gap-3 flex-1 min-w-0"
          >
            <div className="h-8 w-8 flex-shrink-0 flex items-center justify-center">
              {app.icon_url ? (
                <img
                  src={app.icon_url}
                  alt={app.name}
                  className="max-h-8 max-w-8 rounded object-contain"
                />
              ) : (
                <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">
                    {firstLetter}
                  </span>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm group-hover:text-primary transition-colors truncate">
                {app.name}
              </h3>
              {app.description && (
                <p className="text-xs text-muted-foreground truncate">
                  {app.description}
                </p>
              )}
            </div>
            {showSsoBadge && app.sso_type !== "none" && (
              <Badge
                variant={ssoBadgeVariant[app.sso_type] || "outline"}
                className="text-[10px] px-1.5 py-0 flex-shrink-0"
              >
                {app.sso_type.toUpperCase()}
              </Badge>
            )}
          </a>
          {showDragHandle && (
            <div
              {...dragHandleProps}
              className="flex-shrink-0 opacity-0 group-hover:opacity-40 hover:!opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
            >
              <GripVertical className="h-4 w-4" />
            </div>
          )}
        </div>
      </div>
    );
  }
);
