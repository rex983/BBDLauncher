-- Migration 36: for now, junior_manager gets the same app access as
-- senior_manager. Copies every (app, office) grant senior_manager has that
-- junior_manager doesn't. Launcher permissions are already identical (both are
-- in MANAGER_TIER_ROLES). Safe to re-run.

INSERT INTO launcher_role_app_access (role_name, app_id, office)
SELECT 'junior_manager', s.app_id, s.office
FROM launcher_role_app_access s
WHERE s.role_name = 'senior_manager'
  AND NOT EXISTS (
    SELECT 1 FROM launcher_role_app_access j
    WHERE j.role_name = 'junior_manager'
      AND j.app_id = s.app_id
      AND j.office IS NOT DISTINCT FROM s.office
  );
