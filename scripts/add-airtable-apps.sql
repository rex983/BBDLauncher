-- One-shot: add the two Airtable bases as direct-link app tiles and grant
-- access to all roles. Adjust scoping later via /admin/apps UI.

WITH base_order AS (
  SELECT COALESCE(MAX(display_order), -1) AS n FROM launcher_apps
),
inserted AS (
  INSERT INTO launcher_apps
    (name, description, url, icon_url, sso_type, status, display_order, open_in_new_tab)
  VALUES
    ('BST Airtable',
     'Building Success Team Airtable base',
     'https://airtable.com/appbXKGeMV19yiajH',
     'https://static.airtable.com/images/favicon/favicon-32x32.png',
     'direct_link', 'active',
     (SELECT n FROM base_order) + 1, true),
    ('Order Processing Airtable',
     'Order Processing tracker (Airtable)',
     'https://airtable.com/appgyXLIAbFHQuHP5/tblsbFufk5q7qsBcg/viwvlXj3oRGkbWLv5?blocks=hide',
     'https://static.airtable.com/images/favicon/favicon-32x32.png',
     'direct_link', 'active',
     (SELECT n FROM base_order) + 2, true)
  RETURNING id
)
INSERT INTO launcher_role_app_access (role_name, app_id)
SELECT r.name, i.id
FROM inserted i
CROSS JOIN launcher_roles r
ON CONFLICT DO NOTHING;
