import { auth } from "@/auth";
import { handleTrack } from "@/lib/analytics-track";

// Session profile ids can be placeholders ("admin-001", "dev-...") that
// aren't profiles rows; bbd_events.profile_id is a UUID, so send only real
// ones. Email alone is enough: the analytics views resolve email -> profile.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Office analytics: page views + clicks from <Tracker /> (analytics-tracker).
export async function POST(req: Request) {
  const s = await auth();
  const profileId = s?.user?.profileId;
  return handleTrack(
    req,
    s && {
      user: {
        email: s.user?.email,
        profileId: profileId && UUID.test(profileId) ? profileId : null,
        office: s.user?.office ?? null,
      },
    },
  );
}
