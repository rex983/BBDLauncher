"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { getBrowserClient } from "@/lib/supabase/browser";
import {
  canAccessAdminPath,
  canAccessManagementPath,
  canManageContent,
  canRunOffboarding,
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
  AlertTriangle,
  Megaphone,
  UserMinus,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Applications", icon: LayoutGrid },
  { href: "/memos", label: "My Memos", icon: Megaphone },
];

const managementItems = [
  { href: "/management/timesheets", label: "Timesheets", icon: Clock },
  { href: "/management/timeoff", label: "Time-off Queue", icon: CalendarCheck },
  { href: "/management/incidents", label: "Incident Reports", icon: AlertTriangle },
  { href: "/management/memos", label: "Office Memos", icon: Megaphone },
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

// Keep a pending-count badge live via a Supabase realtime subscription on
// `table`. Any INSERT/UPDATE/DELETE triggers a re-fetch of `endpoint` (which
// enforces scope + pending-only server-side, so the filter can't live in the
// channel itself). Beats the old 60s poll on every open tab, and a manager
// acting on one tab clears the badge on all the others.
function usePendingCount(
  enabled: boolean,
  endpoint: string,
  channelName: string,
  table: string,
): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) { setCount(0); return; }
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        setCount(typeof body?.count === "number" ? body.count : 0);
      } catch {
        // Sidebar badge is decorative — swallow errors.
      }
    };
    fetchCount();

    const supabase = getBrowserClient();
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => { fetchCount(); },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [enabled, endpoint, channelName, table]);
  return count;
}

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
  // While previewing another role, hide IT-only nav too (the preview is
  // about what that role sees, and is_it isn't part of the role).
  const showOffboarding = canRunOffboarding(
    effectiveRole,
    isViewingAsOtherRole ? false : session?.user?.is_it,
  );
  const preview = { viewAs, viewAsOffice };
  const pendingCount = usePendingCount(
    showManagementNav,
    "/api/management/timeoff/pending-count",
    "sidebar-pending-count",
    "time_off_requests",
  );
  // Incidents awaiting either the manager's or the employee's signature.
  const pendingIncidents = usePendingCount(
    showManagementNav,
    "/api/management/incidents/pending-count",
    "sidebar-pending-incidents",
    "incident_reports",
  );

  return (
    <aside className="w-64 border-r bg-background min-h-[calc(100vh-4rem)] print:hidden">
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
                <span className="flex-1">{item.label}</span>
                {item.href === "/management/timeoff" && pendingCount > 0 && (
                  <Badge variant="destructive" className="ml-auto tabular-nums">
                    {pendingCount}
                  </Badge>
                )}
                {item.href === "/management/incidents" && pendingIncidents > 0 && (
                  <Badge variant="destructive" className="ml-auto tabular-nums">
                    {pendingIncidents}
                  </Badge>
                )}
              </Link>
            ))}
          </>
        )}

        {showOffboarding && (
          <>
            <div className="mt-6 mb-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              IT
            </div>
            <Link
              href="/offboarding"
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname.startsWith("/offboarding")
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <UserMinus className="h-4 w-4" />
              Offboarding
            </Link>
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
