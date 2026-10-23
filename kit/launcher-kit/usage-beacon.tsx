"use client";

import { useEffect } from "react";

// Active-minutes heartbeat. Render <UsageBeacon /> once in the signed-in
// layout. While the tab is visible and the person did something in the last
// 5 minutes, it pings /api/launcher-usage once a minute (see usage.ts).
// No page views, no clicks, no content: just "was active this minute".

const MINUTE = 60_000;
const IDLE_AFTER = 5 * MINUTE;

export function UsageBeacon() {
  useEffect(() => {
    let lastActive = Date.now();
    let lastMove = 0;
    const active = () => {
      lastActive = Date.now();
    };
    const move = () => {
      const now = Date.now();
      if (now - lastMove > 5_000) lastMove = lastActive = now;
    };
    const ping = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastActive > IDLE_AFTER) return;
      fetch("/api/launcher-usage", { method: "POST", keepalive: true }).catch(() => {});
    };

    const events = ["pointerdown", "keydown", "wheel", "scroll", "focus"] as const;
    for (const e of events) window.addEventListener(e, active, { passive: true, capture: true });
    window.addEventListener("pointermove", move, { passive: true });
    const first = window.setTimeout(ping, 5_000);
    const timer = window.setInterval(ping, MINUTE);

    return () => {
      for (const e of events) window.removeEventListener(e, active, { capture: true });
      window.removeEventListener("pointermove", move);
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
