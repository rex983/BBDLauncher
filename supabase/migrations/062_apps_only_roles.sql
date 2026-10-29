-- Migration 62: "Apps only" roles.
-- Idempotent. Apply in the Supabase SQL Editor for xockuiyvxijuzlwlsfbu.
--
-- A role with apps_only = true sees nothing in the launcher except the time
-- clock and the apps granted to it (role grid or by name): no links, memos,
-- time off, incidents, profile or quote. Made for the trainee role — a new
-- hire sees only the handbook until an admin grants more or moves them to a
-- regular role. Memos skip these people too (src/lib/memos/audience.ts).
--
-- Admin can't be apps only. Other apps don't read the flag: what a role can
-- open in them is still the access grid.

BEGIN;

ALTER TABLE launcher_roles ADD COLUMN IF NOT EXISTS apps_only BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE launcher_roles DROP CONSTRAINT IF EXISTS launcher_roles_apps_only_check;
ALTER TABLE launcher_roles ADD CONSTRAINT launcher_roles_apps_only_check
  CHECK (NOT (apps_only AND (is_admin OR name = 'admin')));

COMMIT;

-- Check (expect: the column, every role false).
SELECT name, apps_only FROM launcher_roles ORDER BY name;
