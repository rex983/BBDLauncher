"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// Default fallback — Slack's web app redirects logged-in Workspace users to
// their team automatically. Override per-tile by adding ?web=<encoded URL>.
const DEFAULT_WEB = "https://app.slack.com/";
const FALLBACK_DELAY_MS = 1500;

// Only allow https Slack URLs — anything else (javascript:, other hosts)
// falls back to DEFAULT_WEB so ?web= can't be used for XSS / open redirect.
function safeWebUrl(raw: string | null): string {
  if (!raw) return DEFAULT_WEB;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol === "https:" &&
      (host === "slack.com" || host.endsWith(".slack.com"))
    ) {
      return url.toString();
    }
  } catch {
    // fall through
  }
  return DEFAULT_WEB;
}

// Slack team IDs are alphanumeric (e.g. T01ABCDEF).
function safeTeam(raw: string | null): string | null {
  return raw && /^[A-Za-z0-9]+$/.test(raw) ? raw : null;
}

function Launcher() {
  const searchParams = useSearchParams();
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    const webUrl = safeWebUrl(searchParams.get("web"));
    const team = safeTeam(searchParams.get("team"));
    const deepLink = team ? `slack://open?team=${team}` : "slack://open";

    let cancelled = false;

    // If the desktop app handles the deep link, the OS will steal focus from
    // the browser tab — visibilitychange fires "hidden", and we cancel the
    // fallback. If nothing handles slack://, focus stays here and we move on
    // to the web app after a short timeout.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        cancelled = true;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const fallbackTimer = window.setTimeout(() => {
      if (cancelled) return;
      window.location.replace(webUrl);
    }, FALLBACK_DELAY_MS);

    // Show a manual "Open Slack on the web" link after the timer in case the
    // browser silently consumed slack:// without launching anything.
    const fallbackUiTimer = window.setTimeout(() => {
      if (!cancelled) setShowFallback(true);
    }, FALLBACK_DELAY_MS + 1500);

    // Trigger the deep link last so the listeners are attached first.
    window.location.href = deepLink;

    return () => {
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(fallbackUiTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [searchParams]);

  const webUrl = safeWebUrl(searchParams.get("web"));

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-3">
        <p className="text-muted-foreground">Opening Slack…</p>
        {showFallback && (
          <a
            href={webUrl}
            className="text-sm underline text-primary"
          >
            Open Slack on the web instead
          </a>
        )}
      </div>
    </div>
  );
}

export default function SlackLaunchPage() {
  return (
    <Suspense>
      <Launcher />
    </Suspense>
  );
}
