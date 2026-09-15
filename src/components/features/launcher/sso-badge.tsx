"use client";

import { useSession } from "next-auth/react";
import { useRolePreview } from "@/components/features/launcher/role-preview-context";
import { Badge } from "@/components/ui/badge";
import type { LauncherApp } from "@/types/app";

const VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  saml: "default",
  oauth: "secondary",
  jwt: "default",
  direct_link: "outline",
  none: "outline",
};

interface SsoBadgeProps {
  ssoType: LauncherApp["sso_type"];
  className?: string;
}

// Admin-only visibility badge. Honors the "view as" preview so admins see
// exactly what each role sees.
export function SsoBadge({ ssoType, className }: SsoBadgeProps) {
  const { data: session } = useSession();
  const { viewAs } = useRolePreview();
  const actualRole = session?.user?.role;
  const effectiveRole = actualRole === "admin" && viewAs ? viewAs : actualRole;
  if (effectiveRole !== "admin" || ssoType === "none") return null;
  return (
    <Badge variant={VARIANT[ssoType] || "outline"} className={className}>
      {ssoType.toUpperCase()}
    </Badge>
  );
}
