"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { PresencePerson } from "./presence";

// "Currently viewing" avatars, like Google Sheets. Render <PresenceAvatars />
// in the header (variant "floating" pins it top-right for apps without one).
// While the tab is visible it pings /api/launcher-presence every 15s and on
// every page change, and shows everyone else in this app: full colour on the
// same page, faded elsewhere, grey when idle. Shows nothing when you're alone.
// Skip it during "View as" (the API ignores those sessions anyway).

const PING_EVERY = 15_000;
const IDLE_AFTER = 5 * 60_000;
const ENDPOINT = "/api/launcher-presence";

function tabId(): string {
  const make = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  try {
    const have = sessionStorage.getItem("launcher-presence-tab");
    if (have) return have;
    const id = make();
    sessionStorage.setItem("launcher-presence-tab", id);
    return id;
  } catch {
    return make();
  }
}

function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function hue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function where(p: PresencePerson): string {
  return `${p.samePage ? "On this page" : "Elsewhere in this app"}${p.idle ? " · idle" : ""}`;
}

function Avatar({ person, size = 28 }: { person: PresencePerson; size?: number }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ring-2 ring-card ${
        person.idle ? "opacity-40 grayscale" : person.samePage ? "" : "opacity-60"
      }`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        backgroundColor: `hsl(${hue(person.id)} 55% 42%)`,
      }}
    >
      {initials(person.name)}
    </span>
  );
}

export function PresenceAvatars({
  max = 4,
  variant = "inline",
}: {
  /** Avatars shown before "+N". */
  max?: number;
  /** "floating" pins it to the top-right corner of the window. */
  variant?: "inline" | "floating";
}) {
  const pathname = usePathname() || "/";
  const [people, setPeople] = useState<PresencePerson[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pathRef = useRef(pathname);
  const pingRef = useRef<() => void>(() => {});

  useEffect(() => {
    const tab = tabId();
    let lastActive = Date.now();
    let lastMove = 0;
    let stopped = false;

    const send = (leave = false) =>
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tab,
          path: pathRef.current,
          idle: Date.now() - lastActive > IDLE_AFTER,
          leave,
        }),
        keepalive: leave,
      });

    const ping = () => {
      if (stopped || document.visibilityState !== "visible") return;
      send()
        .then((r) => (r.ok ? r.json() : { people: [] }))
        .then((d: { people?: PresencePerson[] }) => {
          if (!stopped) setPeople(Array.isArray(d.people) ? d.people : []);
        })
        .catch(() => {});
    };
    pingRef.current = ping;

    const leave = () => {
      send(true).catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") ping();
      else leave();
    };
    const active = () => {
      const wasIdle = Date.now() - lastActive > IDLE_AFTER;
      lastActive = Date.now();
      if (wasIdle) ping();
    };
    const move = () => {
      const now = Date.now();
      if (now - lastMove > 5_000) {
        lastMove = now;
        active();
      }
    };

    const events = ["pointerdown", "keydown", "wheel", "scroll", "focus"] as const;
    for (const e of events) window.addEventListener(e, active, { passive: true, capture: true });
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", leave);
    ping();
    const timer = window.setInterval(ping, PING_EVERY);

    return () => {
      stopped = true;
      for (const e of events) window.removeEventListener(e, active, { capture: true });
      window.removeEventListener("pointermove", move);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", leave);
      window.clearInterval(timer);
      leave();
    };
  }, []);

  // New page: tell the others straight away.
  useEffect(() => {
    if (pathRef.current === pathname) return;
    pathRef.current = pathname;
    pingRef.current();
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (people.length === 0) return null;

  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  const here = people.filter((p) => p.samePage).length;
  const label =
    `${people.length} other ${people.length === 1 ? "person" : "people"} in this app` +
    (here ? `, ${here} on this page` : "");

  return (
    <div
      ref={box}
      className={
        variant === "floating"
          ? "fixed right-4 top-3 z-40 rounded-full border border-border bg-card/95 p-1 shadow-md backdrop-blur"
          : "relative"
      }
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className="flex items-center rounded-full p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex -space-x-2">
          {shown.map((p) => (
            <span key={p.id} title={`${p.name} — ${where(p)}`} className="inline-flex">
              <Avatar person={p} />
            </span>
          ))}
          {extra > 0 && (
            <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground ring-2 ring-card">
              +{extra}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Currently viewing"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Currently viewing</p>
          <ul className="max-h-80 overflow-y-auto">
            {people.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded px-2 py-1.5">
                <Avatar person={p} size={24} />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{p.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{where(p)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
