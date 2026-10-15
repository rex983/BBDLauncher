"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Office analytics: sends page views and clicks to the app's /api/track (see
// src/lib/analytics-track.ts) in small batches. A copy of
// BBDLauncher/kit/launcher-kit/tracker.tsx; keep the two in sync. Mounted once
// in the signed-in layout:
//   <Tracker />
// Clicks record the visible label of the link/button, never what anyone
// typed. Add data-track="Label" to name a control, data-track-ignore to skip.

interface Pending {
  type: "view" | "click";
  path: string;
  label?: string | null;
  target?: string | null;
  seconds?: number;
}

const queue: Pending[] = [];

function flush(useBeacon = false) {
  if (!queue.length) return;
  const body = JSON.stringify(queue.splice(0, 50));
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
  } else {
    void fetch("/api/track", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {});
  }
}

const CLICKABLE = 'a, button, summary, [role="button"], [role="tab"], [role="menuitem"], [data-track]';

function labelOf(el: HTMLElement): string | null {
  const text =
    el.dataset.track ||
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 120) : null;
}

function Views() {
  const pathname = usePathname();
  const search = useSearchParams();
  const since = useRef<{ path: string; at: number } | null>(null);

  useEffect(() => {
    const path = pathname + (search.size ? `?${search.toString()}` : "");
    if (since.current?.path === path) return;
    const prev = since.current;
    queue.push({ type: "view", path, seconds: prev ? Math.round((Date.now() - prev.at) / 1000) : undefined });
    since.current = { path, at: Date.now() };
  }, [pathname, search]);
  return null;
}

export function Tracker() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(CLICKABLE);
      if (!el || el.dataset.trackIgnore != null) return;
      const label = labelOf(el);
      if (!label) return;
      let target: string | null = null;
      if (el instanceof HTMLAnchorElement && el.href) {
        const u = new URL(el.href, location.href);
        target = u.origin === location.origin ? u.pathname + u.search : u.origin + u.pathname;
      }
      queue.push({ type: "click", path: location.pathname + location.search, label, target });
      if (queue.length >= 20) flush();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    const onPageHide = () => flush(true);
    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    const timer = window.setInterval(() => flush(), 5000);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      window.clearInterval(timer);
      flush(true);
    };
  }, []);

  return (
    <Suspense>
      <Views />
    </Suspense>
  );
}
