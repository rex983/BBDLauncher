import { revalidateTag } from "next/cache";

// Tag on the cached profiles read behind every auth() call (src/auth.ts).
export const SESSION_PROFILE_TAG = "session-profiles";

// Call after changing anything auth() reads from profiles: role, office,
// department, is_it, can_offboard, is_active, session_version or
// signed_out_at. Without it the change can take up to 30 seconds to reach
// open sessions.
export function revalidateSessionProfiles() {
  revalidateTag(SESSION_PROFILE_TAG);
}
