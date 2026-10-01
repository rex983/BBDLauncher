-- Migration 40: individual people on apps and links, and a named offboarding
-- team.
--
-- launcher_user_access grants one person an app or a link on top of the
-- office × role grid (apps) or office filter (links). A link marked
-- people_only is shown only to the people listed on it.
--
-- profiles.can_offboard replaces "IT" as the gate for /offboarding (granted
-- per person in Admin → Users). Admins can always open it.

BEGIN;

CREATE TABLE IF NOT EXISTS launcher_user_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  app_id UUID REFERENCES launcher_apps(id) ON DELETE CASCADE,
  link_id UUID REFERENCES launcher_links(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((app_id IS NULL) <> (link_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS launcher_user_access_app_uniq
  ON launcher_user_access(app_id, profile_id) WHERE app_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS launcher_user_access_link_uniq
  ON launcher_user_access(link_id, profile_id) WHERE link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS launcher_user_access_profile_idx
  ON launcher_user_access(profile_id);

ALTER TABLE launcher_user_access ENABLE ROW LEVEL SECURITY;

ALTER TABLE launcher_links
  ADD COLUMN IF NOT EXISTS people_only BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS can_offboard BOOLEAN NOT NULL DEFAULT false;

COMMIT;
