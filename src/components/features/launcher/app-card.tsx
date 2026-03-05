"use client";

import { forwardRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GripVertical } from "lucide-react";
import type { LauncherApp } from "@/types/app";

interface AppCardProps {
  app: LauncherApp;
  isDragging?: boolean;
  dragHandleProps?: Record<string, unknown>;
  style?: React.CSSProperties;
}

const ssoBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  saml: "default",
  oauth: "secondary",
  jwt: "default",
  direct_link: "outline",
  none: "outline",
};

export const AppCard = forwardRef<HTMLDivElement, AppCardProps>(
  function AppCard({ app, isDragging, dragHandleProps, style }, ref) {
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
          <CardContent className="flex flex-col items-center gap-2 p-4 h-full relative">
            <div
              {...dragHandleProps}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-40 hover:!opacity-100 cursor-grab active:cursor-grabbing transition-opacity"
            >
              <GripVertical className="h-4 w-4" />
            </div>
            <a
              href={href}
              target={app.open_in_new_tab ? "_blank" : "_self"}
              rel="noopener noreferrer"
              className="flex flex-col items-center gap-2 flex-1 w-full"
            >
              <div className="h-10 w-10 flex-shrink-0 flex items-center justify-center">
                {app.icon_url ? (
                  <img
                    src={app.icon_url}
                    alt={app.name}
                    className="max-h-10 max-w-10 rounded-md object-contain"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
                    <span className="text-lg font-bold text-primary">
                      {firstLetter}
                    </span>
                  </div>
                )}
              </div>
              <div className="text-center flex-1 flex flex-col justify-center min-h-[2.5rem]">
                <h3 className="font-semibold text-sm group-hover:text-primary transition-colors line-clamp-2">
                  {app.name}
                </h3>
                {app.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {app.description}
                  </p>
                )}
              </div>
              {app.sso_type !== "none" && (
                <Badge variant={ssoBadgeVariant[app.sso_type] || "outline"} className="text-xs">
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
