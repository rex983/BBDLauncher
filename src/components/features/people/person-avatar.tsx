"use client";

import { LauncherAvatar, avatarColor, initials } from "../../../../kit/launcher-kit/launcher-avatar";

// A person's photo. When the caller already knows they have none
// (`hasPhoto={false}`), the initials are drawn without asking the server,
// so a long list doesn't fire a request per row.
export function PersonAvatar({
  profileId,
  name,
  size = 32,
  hasPhoto,
  className = "",
}: {
  profileId: string | null | undefined;
  name: string | null | undefined;
  size?: number;
  hasPhoto?: boolean;
  className?: string;
}) {
  if (hasPhoto === false) {
    return (
      <span
        aria-hidden
        className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium text-white ${className}`}
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.4),
          backgroundColor: avatarColor(profileId || name || "?"),
        }}
      >
        {initials(name)}
      </span>
    );
  }
  return <LauncherAvatar profileId={profileId} name={name} size={size} className={className} />;
}
