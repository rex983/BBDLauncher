"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { PresencePerson } from "./presence";

// "Currently viewing" avatars, like Google Sheets. Render <PresenceAvatars />
// in the header (variant "floating" pins it top-right for apps without one).
// It pings /api/launcher-presence every 15s while the tab is in front (about
// once a minute in a background tab, which counts as away) and on every page
// change, and shows everyone else with this app open.
// Google Docs style: a coloured ring for people on your page, faded when away.
// Hover an avatar for their name and page; click it to go to that page.
// "+N" opens everyone as a list (each row goes to their page too).
// Leaves only when the tab closes. Shows nothing when you're alone.
// Skip it during "View as" (the API ignores those sessions anyway).

const PING_EVERY = 15_000;
const PING_HIDDEN = 45_000; // browsers stretch background timers to ~1 min
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

// Google's collaborator colours: bright, distinct, readable with white text.
const COLORS = ["#1a73e8", "#d93025", "#188038", "#e37400", "#9334e6", "#007b83", "#c5221f", "#b06000", "#3949ab", "#ad1457"];

function color(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

const ID_LIKE = /^([0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{16,}|\d+)$/i;

/** "/c/pricing-apps" -> "Pricing apps"; ids are skipped; "/" -> "Home". */
function pageName(path: string | null): string | null {
  if (!path) return null;
  const words = path
    .split("/")
    .filter((seg) => seg && !ID_LIKE.test(seg))
    .map((seg) => decodeURIComponent(seg).replace(/[-_]+/g, " "));
  const last = words[words.length - 1];
  if (!last) return "Home";
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function where(p: PresencePerson): string {
  const page = p.samePage ? "On this page" : (pageName(p.path) ?? "Elsewhere in this app");
  return `${page}${p.idle ? " · away" : ""}`;
}

function Avatar({ person, size = 32, ring = true }: { person: PresencePerson; size?: number; ring?: boolean }) {
  const c = color(person.id);
  return (
    <span
      aria-hidden
      className={`relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium text-white transition ${
        person.idle ? "opacity-50 grayscale" : ""
      }`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        backgroundColor: c,
        // On your page: a ring in their colour with a gap, like Google's live collaborators.
        boxShadow: ring && person.samePage && !person.idle ? `0 0 0 2px var(--background, #fff), 0 0 0 4px ${c}` : undefined,
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
  const router = useRouter();
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
    let lastPing = 0;

    const send = (leave = false) =>
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tab,
          path: pathRef.current,
          idle: document.visibilityState !== "visible" || Date.now() - lastActive > IDLE_AFTER,
          leave,
        }),
        keepalive: leave,
      });

    const ping = () => {
      if (stopped) return;
      lastPing = Date.now();
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
    // Every 15s in front, every 45s+ in the background (away).
    const tick = () => {
      const every = document.visibilityState === "visible" ? PING_EVERY : PING_HIDDEN;
      if (Date.now() - lastPing >= every - 1_000) ping();
    };
    const onVisibility = () => ping();
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
    const timer = window.setInterval(tick, PING_EVERY);

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
  const go = (p: PresencePerson) => {
    setOpen(false);
    if (p.path && !p.samePage) router.push(p.path);
  };

  return (
    <div
      ref={box}
      className={
        variant === "floating"
          ? "fixed right-4 top-3 z-40 flex items-center rounded-full bg-card/90 p-1.5 shadow-md backdrop-blur"
          : "relative flex items-center"
      }
    >
      <ul className="flex items-center gap-1.5" aria-label="Currently viewing">
        {shown.map((p) => {
          const canGo = !!p.path && !p.samePage;
          return (
            <li key={p.id} className="group relative">
              <button
                type="button"
                onClick={() => go(p)}
                aria-label={`${p.name}, ${where(p)}${canGo ? ". Go to their page" : ""}`}
                className={`block rounded-full outline-none transition hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  canGo ? "cursor-pointer" : "cursor-default"
                }`}
              >
                <Avatar person={p} />
              </button>
              <span
                role="tooltip"
                className="pointer-events-none absolute right-1/2 top-full z-50 mt-2 translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-800 px-2.5 py-1.5 text-left text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <span className="block font-medium">{p.name}</span>
                <span className="block text-white/70">{where(p)}</span>
                {canGo && <span className="mt-0.5 block text-[11px] text-sky-300">Click to go to their page</span>}
              </span>
            </li>
          );
        })}
        {extra > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={`${extra} more ${extra === 1 ? "person" : "people"} in this app`}
              // Solid grey like Google's "+N", so it reads on light and dark headers alike.
              style={{ backgroundColor: "#5f6368", color: "#fff" }}
              className="flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-xs font-medium outline-none transition hover:-translate-y-px hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              +{extra}
            </button>
          </li>
        )}
      </ul>
      {open && (
        <div
          role="dialog"
          aria-label="Everyone in this app"
          className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
        >
          <p className="border-b border-border px-4 py-2.5 text-sm font-medium text-popover-foreground">
            {people.length} {people.length === 1 ? "person" : "people"} in this app
          </p>
          <ul className="max-h-80 overflow-y-auto py-1">
            {people.map((p) => {
              const canGo = !!p.path && !p.samePage;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => go(p)}
                    disabled={!canGo}
                    className="flex w-full items-center gap-3 px-4 py-2 text-left outline-none transition enabled:hover:bg-accent focus-visible:bg-accent disabled:cursor-default"
                  >
                    <Avatar person={p} ring={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-popover-foreground">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{where(p)}</span>
                    </span>
                    {canGo && <span className="text-xs text-muted-foreground">Go</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
