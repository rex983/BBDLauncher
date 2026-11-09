"use client";

import { useEffect, useState } from "react";
import { LAUNCHER_URL } from "./urls";

// Someone's profile photo, from their launcher profile (launcher migration
// 066). The launcher's /api/avatar/<profile_id> redirects to the current
// photo (cached a minute) or 404s; then this falls back to `fallbackSrc`
// (e.g. their Google picture), then to coloured initials.
//
//   <LauncherAvatar profileId={user.id} name={user.name} size={32} />
//
// After someone changes their photo in the launcher, the launcher fires the
// "launcher-avatar-changed" window event so its own avatars refresh at once;
// other apps pick it up within a couple of minutes.

export const AVATAR_CHANGED_EVENT = "launcher-avatar-changed";

export function avatarUrl(profileId: string, version?: number | string): string {
  return `${LAUNCHER_URL}/api/avatar/${encodeURIComponent(profileId)}${version ? `?v=${version}` : ""}`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name || "").replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Google's collaborator colours: bright, distinct, readable with white text.
const COLORS = ["#1a73e8", "#d93025", "#188038", "#e37400", "#9334e6", "#007b83", "#c5221f", "#b06000", "#3949ab", "#ad1457"];

export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function LauncherAvatar({
  profileId,
  name,
  size = 32,
  fallbackSrc,
  className = "",
  style,
}: {
  profileId: string | null | undefined;
  name: string | null | undefined;
  size?: number;
  /** Tried when they have no launcher photo (e.g. session.user.image). */
  fallbackSrc?: string | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [version, setVersion] = useState<number | undefined>(undefined);
  // 0 = launcher photo, 1 = fallbackSrc, 2 = initials. A failed load moves
  // down a step; a new person, fallback or photo version starts over.
  const key = `${profileId ?? ""}|${fallbackSrc ?? ""}|${version ?? ""}`;
  const [failed, setFailed] = useState<{ key: string; step: number } | null>(null);
  const step = failed?.key === key ? failed.step : profileId ? 0 : fallbackSrc ? 1 : 2;

  useEffect(() => {
    const onChange = (e: Event) => {
      const id = (e as CustomEvent<{ profileId?: string }>).detail?.profileId;
      if (!id || id === profileId) setVersion(Date.now());
    };
    window.addEventListener(AVATAR_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(AVATAR_CHANGED_EVENT, onChange);
  }, [profileId]);

  const src = step === 0 && profileId ? avatarUrl(profileId, version) : step === 1 ? fallbackSrc : null;
  const box: React.CSSProperties = { width: size, height: size, ...style };

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- cross-origin, tiny, already sized
      <img
        key={src}
        src={src}
        alt={name || ""}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailed({ key, step: step === 0 && fallbackSrc ? 1 : 2 })}
        className={`inline-block shrink-0 rounded-full object-cover ${className}`}
        style={box}
      />
    );
  }
  return (
    <span
      aria-label={name || undefined}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium text-white ${className}`}
      style={{ ...box, fontSize: Math.round(size * 0.4), backgroundColor: avatarColor(profileId || name || "?") }}
    >
      {initials(name)}
    </span>
  );
}
