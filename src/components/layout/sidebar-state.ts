// Sidebar layout state lives in a cookie (not localStorage) so the server
// renders the rail and sections in their saved state on the first frame,
// with no expand-then-collapse flash on every navigation or reload.

export const SIDEBAR_COOKIE = "sidebar_state";

export interface SidebarState {
  collapsed: boolean;
  // Section ids the user has folded shut. Sections are open by default.
  closed: string[];
}

export const DEFAULT_SIDEBAR_STATE: SidebarState = { collapsed: false, closed: [] };

export function parseSidebarState(raw: string | undefined): SidebarState {
  if (!raw) return DEFAULT_SIDEBAR_STATE;
  try {
    const v = JSON.parse(decodeURIComponent(raw));
    return {
      collapsed: v?.collapsed === true,
      closed: Array.isArray(v?.closed)
        ? v.closed.filter((x: unknown): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return DEFAULT_SIDEBAR_STATE;
  }
}

export function writeSidebarState(state: SidebarState) {
  const value = encodeURIComponent(JSON.stringify(state));
  document.cookie = `${SIDEBAR_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
}
