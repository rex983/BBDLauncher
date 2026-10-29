"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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
  UserCheck,
  MailWarning,
  History,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Building2,
  Network,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { writeSidebarState, type SidebarState } from "./sidebar-state";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Applications", icon: LayoutGrid },
  { href: "/memos", label: "My Memos", icon: Megaphone },
];

const managementItems: NavItem[] = [
  { href: "/management/timesheets", label: "Timesheets", icon: Clock },
  { href: "/management/attendance", label: "Attendance", icon: UserCheck },
  { href: "/management/timeoff", label: "Time-off Queue", icon: CalendarCheck },
  { href: "/management/incidents", label: "Incident Reports", icon: AlertTriangle },
  { href: "/management/memos", label: "Office Memos", icon: Megaphone },
  { href: "/management/teams", label: "Teams", icon: UsersRound },
];

const offboardingItems: NavItem[] = [
  { href: "/offboarding", label: "Offboarding", icon: UserMinus },
];

const adminItems: NavItem[] = [
  { href: "/admin/apps", label: "Manage Apps", icon: Settings },
  { href: "/admin/sections", label: "Manage Sections", icon: FolderTree },
  { href: "/admin/links", label: "Manage Links", icon: Link2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/manufacturers", label: "Manufacturers", icon: Factory },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/quotes", label: "Quotes", icon: Quote },
  { href: "/admin/roles", label: "Roles", icon: ShieldCheck },
  { href: "/admin/offices", label: "Offices", icon: Building2 },
  { href: "/admin/departments", label: "Departments", icon: Network },
  { href: "/admin/sso", label: "SSO Overview", icon: KeyRound },
  { href: "/admin/email-monitor", label: "Email Monitor", icon: MailWarning },
  { href: "/admin/audit", label: "Audit Log", icon: History },
];

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

// Pending-count badge. Fetched on load, then re-checked when the person
// comes back to the tab or moves to another page, at most once a minute.
// (These used to be Supabase realtime subscriptions, but none of the
// tables are in the realtime publication, so they never fired: the
// badges only updated on a full reload.)
const BADGE_REFRESH_MS = 60_000;

function usePendingCount(enabled: boolean, endpoint: string, pathname: string): number {
  const [count, setCount] = useState(0);
  const fetchedAt = useRef(0);

  const refresh = useCallback(
    async (force = false) => {
      if (!force && Date.now() - fetchedAt.current < BADGE_REFRESH_MS) return;
      fetchedAt.current = Date.now();
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        setCount(typeof body?.count === "number" ? body.count : 0);
      } catch {
        // Sidebar badge is decorative — swallow errors.
      }
    },
    [endpoint],
  );

  useEffect(() => {
    if (!enabled) { setCount(0); fetchedAt.current = 0; return; }
    refresh(true);
    const onBack = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onBack);
    return () => document.removeEventListener("visibilitychange", onBack);
  }, [enabled, refresh]);

  // A manager who just handled a request expects the badge to move.
  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh, pathname]);

  return count;
}

const NavLink = memo(function NavLink({
  item,
  href,
  active,
  collapsed,
  badge,
}: {
  item: NavItem;
  href: string;
  active: boolean;
  collapsed: boolean;
  badge?: number;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={href}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors",
        collapsed ? "justify-center px-2" : "px-3",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {collapsed ? (
        <>
          <span className="sr-only">{item.label}</span>
          {!!badge && (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
          )}
        </>
      ) : (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {!!badge && (
            <Badge variant="destructive" className="tabular-nums">
              {badge}
            </Badge>
          )}
        </>
      )}
    </Link>
  );
});

export function Sidebar({ initialState }: { initialState: SidebarState }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const actualRole = session?.user?.permRole;
  const { viewAsUser, exitPreview } = useRolePreview();
  // A View as shows that person's nav, for admins and managers alike.
  const isPreviewing = !!viewAsUser;
  // Permission roles (acts_as ?? role) decide which nav shows.
  const effectiveRole = (isPreviewing ? viewAsUser!.perm_role : actualRole) as UserRole | undefined;
  const showManagementNav = canViewTimeData(effectiveRole);
  const showOffboarding = canRunOffboarding(
    effectiveRole,
    isPreviewing ? viewAsUser!.can_offboard : session?.user?.can_offboard,
  );
  const preview = isPreviewing ? viewAsUser : null;
  const pendingCount = usePendingCount(showManagementNav, "/api/management/timeoff/pending-count", pathname);
  // Incidents awaiting either the manager's or the employee's signature.
  const pendingIncidents = usePendingCount(showManagementNav, "/api/management/incidents/pending-count", pathname);
  // Admins only: failing Email monitor health checks, so a
  // stopped script shows up without anyone visiting the page.
  const retiredMailProblems = usePendingCount(isAdminRole(effectiveRole), "/api/admin/retired-mail/status", pathname);
  const badges: Record<string, number> = {
    "/management/timeoff": pendingCount,
    "/management/incidents": pendingIncidents,
    "/admin/email-monitor": retiredMailProblems,
  };

  const sections: NavSection[] = [];
  if (showManagementNav) {
    const items = managementItems.filter((i) => canAccessManagementPath(effectiveRole, i.href));
    if (items.length) sections.push({ id: "management", label: "Management", items });
  }
  if (showOffboarding) {
    sections.push({ id: "people", label: "People", items: offboardingItems });
  }
  if (canManageContent(effectiveRole)) {
    const items = adminItems.filter((i) => canAccessAdminPath(effectiveRole, i.href));
    if (items.length) sections.push({ id: "admin", label: "Admin", items });
  }

  const [state, setState] = useState(initialState);
  const update = (next: SidebarState) => {
    setState(next);
    writeSidebarState(next);
  };
  const { collapsed } = state;
  const closed = new Set(state.closed);

  // Navigating into a folded section (e.g. via a link on the page) unfolds
  // it, so the current page is always visible in the nav.
  const activeSection = sections.find((sec) =>
    sec.items.some((i) => pathname.startsWith(i.href)),
  )?.id;
  const [prevPath, setPrevPath] = useState(pathname);
  if (pathname !== prevPath) {
    setPrevPath(pathname);
    if (activeSection && closed.has(activeSection)) {
      update({ ...state, closed: state.closed.filter((id) => id !== activeSection) });
    }
  }

  const toggleSection = (id: string) =>
    update({
      ...state,
      closed: closed.has(id) ? state.closed.filter((x) => x !== id) : [...state.closed, id],
    });

  return (
    <aside
      className={cn(
        "sticky top-0 flex max-h-screen min-h-[calc(100vh-4rem)] shrink-0 flex-col self-start overflow-y-auto border-r bg-background transition-[width] duration-200 print:hidden",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <nav className={cn("flex flex-1 flex-col gap-1", collapsed ? "p-2" : "p-3")}>
        <button
          type="button"
          onClick={() => update({ ...state, collapsed: !collapsed })}
          title={collapsed ? "Expand menu" : "Collapse menu"}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          aria-expanded={!collapsed}
          className={cn(
            "mb-1 flex items-center rounded-md py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
            collapsed ? "justify-center px-2" : "justify-end px-3",
          )}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>

        {navItems.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            href={buildPreviewHref(item.href, viewAsUser)}
            active={pathname === item.href}
            collapsed={collapsed}
          />
        ))}

        {sections.map((sec) => {
          // The icon rail always lists every item: icons are compact, and a
          // folded section there would hide pages with no visible header.
          const open = collapsed || !closed.has(sec.id);
          const hiddenBadges = open
            ? 0
            : sec.items.reduce((n, i) => n + (badges[i.href] ?? 0), 0);
          return (
            <div key={sec.id} className="mt-3 flex flex-col gap-1">
              {collapsed ? (
                <div className="mx-2 mb-1 border-t" role="separator" aria-label={sec.label} />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleSection(sec.id)}
                  aria-expanded={open}
                  className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="flex-1 text-left">{sec.label}</span>
                  {hiddenBadges > 0 && (
                    <Badge variant="destructive" className="tabular-nums">
                      {hiddenBadges}
                    </Badge>
                  )}
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")}
                  />
                </button>
              )}
              {open &&
                sec.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    href={buildPreviewHref(item.href, preview)}
                    active={pathname.startsWith(item.href)}
                    collapsed={collapsed}
                    badge={badges[item.href]}
                  />
                ))}
            </div>
          );
        })}

        {!!viewAsUser && (
          <button
            type="button"
            onClick={exitPreview}
            title={collapsed ? "Exit preview" : undefined}
            className={cn(
              "mt-6 flex items-center justify-center gap-2 rounded-md py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
              collapsed ? "px-2" : "px-3",
            )}
          >
            {collapsed ? (
              <>
                <X className="h-4 w-4" />
                <span className="sr-only">Exit preview</span>
              </>
            ) : (
              "Exit preview"
            )}
          </button>
        )}
      </nav>
    </aside>
  );
}
