-- Migration 56: teams — a team leader and the reps on their team.
-- Idempotent, one transaction. Apply in the Supabase SQL Editor for
-- xockuiyvxijuzlwlsfbu.
--
-- Managed by management in the launcher (/management/teams); every app on
-- this shared database reads them through the launcher kit
-- (getLauncherTeams in kit/launcher-kit/org.ts). Rep Insights uses them for
-- team analytics.
--
--   launcher_teams         (id, name, office, leader_id) — one office per team
--   launcher_team_members  (profile_id pk, team_id)      — a person is on at most one team
--
-- The leader is not a member row; leading a team and being on one are
-- separate (a leader may lead more than one team). Deleting a team removes
-- its member rows; deleting a profile removes its membership and clears any
-- team it led.

BEGIN;

CREATE TABLE IF NOT EXISTS launcher_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  office TEXT NOT NULL REFERENCES launcher_offices(name) ON UPDATE CASCADE,
  leader_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT launcher_teams_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 60)
);

CREATE UNIQUE INDEX IF NOT EXISTS launcher_teams_name_key ON launcher_teams (lower(btrim(name)));
CREATE INDEX IF NOT EXISTS launcher_teams_leader_idx ON launcher_teams (leader_id);

CREATE TABLE IF NOT EXISTS launcher_team_members (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES launcher_teams(id) ON DELETE CASCADE,
  added_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS launcher_team_members_team_idx ON launcher_team_members (team_id);

-- Service-role only: RLS on, no policies, nothing for anon / authenticated.
ALTER TABLE launcher_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON launcher_teams FROM anon, authenticated;
REVOKE ALL ON launcher_team_members FROM anon, authenticated;

COMMIT;

-- Check (expect two tables with RLS on).
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('launcher_teams', 'launcher_team_members');
