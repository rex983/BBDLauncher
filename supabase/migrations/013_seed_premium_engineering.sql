-- Migration 13: seed Premium Engineering tile (admin-only)
--
-- Not yet publicly deploying; register the app with admin-only access so it
-- stays hidden from every other role. Flip additional roles into
-- launcher_role_app_access (or use the /admin/apps UI) once we launch.

INSERT INTO launcher_apps (
  name,
  description,
  url,
  sso_type,
  status,
  display_order,
  open_in_new_tab
)
SELECT
  'Premium Engineering',
  'Snow/wind structural adders for Premium Steel buildings.',
  'https://premium-engineering.vercel.app',
  'none',
  'active',
  0,
  TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM launcher_apps WHERE url = 'https://premium-engineering.vercel.app'
);

INSERT INTO launcher_role_app_access (role_name, app_id)
SELECT 'admin', id
FROM launcher_apps
WHERE url = 'https://premium-engineering.vercel.app'
ON CONFLICT DO NOTHING;
