"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { LauncherApp } from "@/types/app";

interface AppCardProps {
  app: LauncherApp;
}

const ssoBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  saml: "default",
  oauth: "secondary",
  direct_link: "outline",
  none: "outline",
};

export function AppCard({ app }: AppCardProps) {
  const firstLetter = app.name.charAt(0).toUpperCase();

  // For direct_link / none, link straight to the URL (avoids /api/launch round-trip in dev)
  const href =
    app.sso_type === "direct_link" || app.sso_type === "none"
      ? app.url
      : `/api/launch/${app.id}`;

  return (
    <a href={href} target={app.open_in_new_tab ? "_blank" : "_self"} rel="noopener noreferrer">
      <Card className="group cursor-pointer transition-all hover:shadow-md hover:border-primary/50">
        <CardContent className="flex flex-col items-center gap-3 p-6">
          {app.icon_url ? (
            <img
              src={app.icon_url}
              alt={app.name}
              className="h-16 w-16 rounded-lg object-contain"
            />
          ) : (
            <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center">
              <span className="text-2xl font-bold text-primary">
                {firstLetter}
              </span>
            </div>
          )}
          <div className="text-center">
            <h3 className="font-semibold text-sm group-hover:text-primary transition-colors">
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
        </CardContent>
      </Card>
    </a>
  );
}
