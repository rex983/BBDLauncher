"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Bell, Check, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getBrowserClient } from "@/lib/supabase/browser";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  reference_type: string | null;
  reference_id: string | null;
  read_at: string | null;
  created_at: string;
}

function fmtRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsBell() {
  const { data: session, status: sessionStatus } = useSession();
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/notifications?limit=50", { cache: "no-store" });
    setLoading(false);
    if (!res.ok) return;
    const body: Notification[] = await res.json();
    setItems(body);
    setUnreadCount(body.filter((n) => !n.read_at).length);
  }, []);

  const fetchCount = useCallback(async () => {
    const res = await fetch("/api/notifications/count", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json();
    setUnreadCount(typeof body?.count === "number" ? body.count : 0);
  }, []);

  // Subscribe once we know who the user is. Any INSERT/UPDATE on their
  // notifications refreshes the count immediately, and the full list if
  // the dropdown is open.
  useEffect(() => {
    if (sessionStatus !== "authenticated" || !session?.user?.profileId) return;
    fetchCount();
    const supabase = getBrowserClient();
    const channel = supabase
      .channel(`notifications-${session.user.profileId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${session.user.profileId}`,
        },
        () => {
          fetchCount();
          if (open) fetchList();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.profileId, sessionStatus, open, fetchCount, fetchList]);

  // Load the list when the user opens the dropdown so we always show the
  // freshest data (in case the realtime subscription missed anything).
  useEffect(() => {
    if (open) fetchList();
  }, [open, fetchList]);

  const markRead = async (id: string) => {
    // Optimistic — flip locally, revert on failure.
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    await fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
  };

  const dismiss = async (id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    await fetch(`/api/notifications/${id}`, { method: "DELETE" });
    fetchCount();
  };

  const markAllRead = async () => {
    setItems((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
    );
    setUnreadCount(0);
    await fetch("/api/notifications/read-all", { method: "POST" });
  };

  const activate = async (n: Notification) => {
    if (!n.read_at) markRead(n.id);
    setOpen(false);
  };

  const showBadge = unreadCount > 0;
  const badgeText = useMemo(() => (unreadCount > 99 ? "99+" : String(unreadCount)), [unreadCount]);

  // Never render for anonymous — the header shows nothing until session
  // hydrates.
  if (sessionStatus !== "authenticated") return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {showBadge && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-4 min-w-[1rem] rounded-full px-1 text-[10px] leading-none tabular-nums"
            >
              {badgeText}
            </Badge>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator className="m-0" />
        <div className="max-h-[24rem] overflow-y-auto">
          {loading && items.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          )}
          {!loading && items.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              You&apos;re all caught up.
            </p>
          )}
          {items.map((n) => {
            const unread = !n.read_at;
            const inner = (
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {unread && (
                    <span
                      className="h-2 w-2 rounded-full bg-blue-500"
                      aria-label="Unread"
                    />
                  )}
                  <p className="text-sm font-medium truncate">{n.title}</p>
                </div>
                {n.body && (
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                    {n.body}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {fmtRelative(n.created_at)}
                </p>
              </div>
            );
            return (
              <div
                key={n.id}
                className={`group flex items-start gap-2 border-b px-3 py-3 last:border-b-0 hover:bg-accent/40 ${
                  unread ? "bg-accent/10" : ""
                }`}
              >
                {n.href ? (
                  <Link
                    href={n.href}
                    onClick={() => activate(n)}
                    className="flex flex-1 min-w-0 cursor-pointer"
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => activate(n)}
                    className="flex flex-1 min-w-0 text-left"
                  >
                    {inner}
                  </button>
                )}
                <div className="flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {unread && (
                    <button
                      type="button"
                      onClick={() => markRead(n.id)}
                      title="Mark as read"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => dismiss(n.id)}
                    title="Dismiss"
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
