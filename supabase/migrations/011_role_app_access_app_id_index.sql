-- Migration 11: Index launcher_role_app_access on (app_id).
-- The primary key is (role_name, app_id), so queries that filter by app_id
-- alone fall back to a sequential scan. Routes like /api/apps and
-- /api/launch/[appId] do exactly that — add a dedicated index so they're
-- O(log n) instead of O(n).

CREATE INDEX IF NOT EXISTS launcher_role_app_access_app_id_idx
  ON launcher_role_app_access(app_id);
