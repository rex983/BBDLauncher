-- Migration 34: per-office app access (office × role grid).
-- Idempotent. Apply in the Supabase SQL Editor for xockuiyvxijuzlwlsfbu.
--
-- Before: an app had a role list (launcher_role_app_access) AND an office list
-- (launcher_apps.offices), and a user needed both — so "Harbor: managers only,
-- BST: everyone" couldn't be expressed.
--
-- After: each access row carries an office.
--   office IS NULL        → that role can open the app from every office
--                           (including people with no office set)
--   office = 'Harbor' …   → only from that office
--   office = 'none'       → only people with no office set
-- launcher_apps.offices stays as a legacy gate (backed up here); saving an app's
-- grid clears that app's list.
-- Every user keeps exactly the access they had (verified by script before deploy).

-- 1. Back up the app office lists (first run only).
CREATE TABLE IF NOT EXISTS launcher_apps_offices_backup_034 AS
  SELECT id AS app_id, offices, NOW() AS backed_up_at
  FROM launcher_apps
  WHERE COALESCE(array_length(offices, 1), 0) > 0;

-- 2. Office column; rows are now (role, app, office).
ALTER TABLE launcher_role_app_access ADD COLUMN IF NOT EXISTS office TEXT;

ALTER TABLE launcher_role_app_access DROP CONSTRAINT IF EXISTS launcher_role_app_access_office_check;
ALTER TABLE launcher_role_app_access ADD CONSTRAINT launcher_role_app_access_office_check
  CHECK (office IS NULL OR office IN ('Harbor', 'BST', 'RnD', 'none'));

ALTER TABLE launcher_role_app_access DROP CONSTRAINT IF EXISTS launcher_role_app_access_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS launcher_role_app_access_uniq
  ON launcher_role_app_access (role_name, app_id, COALESCE(office, '*'));
CREATE INDEX IF NOT EXISTS launcher_role_app_access_app_idx ON launcher_role_app_access (app_id);

-- 3. Fold each app's office list into its rows: role × listed office.
INSERT INTO launcher_role_app_access (role_name, app_id, office)
SELECT a.role_name, a.app_id, o.office
FROM launcher_role_app_access a
JOIN launcher_apps p ON p.id = a.app_id
CROSS JOIN LATERAL unnest(p.offices) AS o(office)
WHERE a.office IS NULL
  AND COALESCE(array_length(p.offices, 1), 0) > 0
ON CONFLICT DO NOTHING;

DELETE FROM launcher_role_app_access a
USING launcher_apps p
WHERE p.id = a.app_id
  AND a.office IS NULL
  AND COALESCE(array_length(p.offices, 1), 0) > 0;

-- 4. launcher_apps.offices is left as it was. The grid already encodes it, and
--    the app still ANDs it in as a legacy gate, so both the old and new app code
--    give identical access whichever deploys first. (Emptying it here, as a first
--    draft did, let the old code ignore office limits until the new code shipped.)
--    Saving an app's access grid clears that app's list.
