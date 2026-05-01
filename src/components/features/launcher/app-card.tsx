"use client";

import { forwardRef } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GripVertical, Star } from "lucide-react";
import type { LauncherApp } from "@/types/app";

interface AppCardProps {
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

export const AppCard = forwardRef<HTMLDivElement, AppCardProps>(
  function AppCard(
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
    // Honor admin's "view as" preview so admins see exactly what each role sees.
    const effectiveRole = actualRole === "admin" && viewAs ? viewAs : actualRole;
    const showSsoBadge = effectiveRole === "admin";
    const firstLetter = app.name.charAt(0).toUpperCase();

    const href =
      app.sso_type === "direct_link" || app.sso_type === "none"
        ? app.url
        : `/api/launch/${app.id}`;

    return (
      <div ref={ref} style={style} className={isDragging ? "z-50" : ""}>
        <Card
          className={`group transition-all hover:shadow-md hover:border-primary/50 h-full ${
            isDragging ? "shadow-lg ring-2 ring-primary/30 opacity-90" : ""
          }`}
        >
          <CardContent className="flex flex-col items-center gap-1.5 p-3 h-full relative">
            {onToggleFavorite && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleFavorite(app.id);
                }}
                aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                className={`absolute top-1 left-1 transition-opacity ${
                  isFavorite
                    ? "opacity-100 text-yellow-500"
                    : "opacity-0 group-hover:opacity-40 hover:!opacity-100 text-muted-foreground"
                }`}
              >
                <Star
                  className="h-3.5 w-3.5"
                  fill={isFavorite ? "currentColor" : "none"}
                />
              </button>
            )}
            {showDragHandle && (
              <div
                {...dragHandleProps}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-40 hover:!opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
              >
                <GripVertical className="h-3.5 w-3.5" />
              </div>
            )}
            <a
              href={href}
              target={app.open_in_new_tab ? "_blank" : "_self"}
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-1.5 flex-1 w-full"
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
              <div className="text-center flex-1 flex flex-col justify-center">
                <h3 className="font-semibold text-xs group-hover:text-primary transition-colors line-clamp-1">
                  {app.name}
                </h3>
                {app.description && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                    {app.description}
                  </p>
                )}
              </div>
              {showSsoBadge && app.sso_type !== "none" && (
                <Badge variant={ssoBadgeVariant[app.sso_type] || "outline"} className="text-[10px] px-1.5 py-0">
                  {app.sso_type.toUpperCase()}
                </Badge>
              )}
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }
);
