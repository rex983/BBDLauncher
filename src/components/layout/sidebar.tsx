"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  canAccessAdminPath,
  canAccessManagementPath,
  canManageContent,
  canViewTimeData,
  isAdmin as isAdminRole,
} from "@/lib/auth/permissions";
import type { UserRole } from "@/types/auth";
import {
  buildPreviewHref,
  useRolePreview,
} from "@/components/features/launcher/role-preview-context";
import {
  LayoutGrid,
  Settings,
  Users,
  ShieldCheck,
  KeyRound,
  Link2,
  FolderTree,
  Factory,
  BarChart3,
  Quote,
  Clock,
  CalendarCheck,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Applications", icon: LayoutGrid },
];

const managementItems = [
  { href: "/management/timesheets", label: "Timesheets", icon: Clock },
  { href: "/management/timeoff", label: "Time-off Queue", icon: CalendarCheck },
];

const adminItems = [
  { href: "/admin/apps", label: "Manage Apps", icon: Settings },
  { href: "/admin/sections", label: "Manage Sections", icon: FolderTree },
  { href: "/admin/links", label: "Manage Links", icon: Link2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/manufacturers", label: "Manufacturers", icon: Factory },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/quotes", label: "Quotes", icon: Quote },
  { href: "/admin/roles", label: "Roles", icon: ShieldCheck },
  { href: "/admin/sso", label: "SSO Overview", icon: KeyRound },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const actualRole = session?.user?.role;
  const isAdmin = isAdminRole(actualRole);
  const { viewAs, viewAsOffice, exitPreview } = useRolePreview();
  const isViewingAsOtherRole = isAdmin && !!viewAs && viewAs !== actualRole;
  const isViewingAsOtherOffice = isAdmin && !!viewAsOffice;
  const isPreviewing = isViewingAsOtherRole || isViewingAsOtherOffice;
  const effectiveRole = (isViewingAsOtherRole ? viewAs : actualRole) as UserRole | undefined;
  const showAdminNav = canManageContent(effectiveRole);
  const visibleAdminItems = adminItems.filter((item) =>
    canAccessAdminPath(effectiveRole, item.href)
  );
  const showManagementNav = canViewTimeData(effectiveRole);
  const visibleManagementItems = managementItems.filter((item) =>
    canAccessManagementPath(effectiveRole, item.href)
  );
  const preview = { viewAs, viewAsOffice };

  return (
    <aside className="w-64 border-r bg-background min-h-[calc(100vh-4rem)]">
      <nav className="flex flex-col gap-1 p-4">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={buildPreviewHref(item.href, preview)}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname === item.href
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}

        {showManagementNav && visibleManagementItems.length > 0 && (
          <>
            <div className="mt-6 mb-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Management
            </div>
            {visibleManagementItems.map((item) => (
              <Link
                key={item.href}
                href={buildPreviewHref(item.href, preview)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  pathname.startsWith(item.href)
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </>
        )}

        {showAdminNav && (
          <>
            <div className="mt-6 mb-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Admin
            </div>
            {visibleAdminItems.map((item) => (
              <Link
                key={item.href}
                href={buildPreviewHref(item.href, preview)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  pathname.startsWith(item.href)
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </>
        )}

        {isPreviewing && (
          <div className="mt-6 px-3">
            <button
              type="button"
              onClick={exitPreview}
              className="flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Exit role preview
            </button>
          </div>
        )}
      </nav>
    </aside>
  );
}
