"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  Settings,
  Users,
  ShieldCheck,
  KeyRound,
  Link2,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Applications", icon: LayoutGrid },
];

const adminItems = [
  { href: "/admin/apps", label: "Manage Apps", icon: Settings },
  { href: "/admin/links", label: "Manage Links", icon: Link2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/roles", label: "Roles", icon: ShieldCheck },
  { href: "/admin/sso", label: "SSO Overview", icon: KeyRound },
];

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const viewAs = searchParams.get("viewAs");
  const isViewingAsOtherRole = isAdmin && viewAs && viewAs !== session?.user?.role;

  return (
    <aside className="w-64 border-r bg-background min-h-[calc(100vh-4rem)]">
      <nav className="flex flex-col gap-1 p-4">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
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

        {isAdmin && !isViewingAsOtherRole && (
          <>
            <div className="mt-6 mb-2 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Admin
            </div>
            {adminItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
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

        {isViewingAsOtherRole && (
          <div className="mt-6 px-3">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Exit role preview
            </Link>
          </div>
        )}
      </nav>
    </aside>
  );
}
