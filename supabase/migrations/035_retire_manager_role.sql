-- Migration 35: retire the plain 'manager' role — 'senior_manager' replaces it
-- everywhere. 'junior_manager' is unchanged.
--
-- Anyone still on 'manager' becomes 'senior_manager', and every app 'manager'
-- could open (in whichever offices) is granted to 'senior_manager' instead.
-- Safe to re-run.

BEGIN;

-- 1. People.
UPDATE profiles SET role = 'senior_manager' WHERE role = 'manager';

-- 2. App access: carry each (app, office) grant over, skipping ones
--    senior_manager already has. (office NULL = every office.)
INSERT INTO launcher_role_app_access (role_name, app_id, office)
SELECT 'senior_manager', m.app_id, m.office
FROM launcher_role_app_access m
WHERE m.role_name = 'manager'
  AND NOT EXISTS (
    SELECT 1 FROM launcher_role_app_access s
    WHERE s.role_name = 'senior_manager'
      AND s.app_id = m.app_id
      AND s.office IS NOT DISTINCT FROM m.office
  );

-- 3. Remove the role (its remaining access rows go with it: ON DELETE CASCADE).
DELETE FROM launcher_role_app_access WHERE role_name = 'manager';
DELETE FROM launcher_roles WHERE name = 'manager';

COMMIT;

-- Check: all three should return 0.
SELECT
  (SELECT count(*) FROM profiles WHERE role = 'manager')                      AS people_on_manager,
  (SELECT count(*) FROM launcher_role_app_access WHERE role_name = 'manager') AS access_rows,
  (SELECT count(*) FROM launcher_roles WHERE name = 'manager')                AS role_rows;
