-- Migration 50: enable JWT-SSO for the ASC Pricer tile, and check that every
-- app is registered.
--
-- Apps only let people in when launcher_can_open_app (migration 049) says
-- yes, and it answers per JWT audience — an app with no launcher_sso_configs
-- row locks everyone out. ASC Pricer's verifier expects
--   issuer = "bbd-launcher", audience = "asc-pricer"
-- and its ACS is the /sso/callback page.

UPDATE launcher_apps
SET sso_type = 'jwt'
WHERE rtrim(url, '/') = 'https://asc-pricing.vercel.app';

INSERT INTO launcher_sso_configs (app_id, jwt_acs_url, jwt_audience)
SELECT id, 'https://asc-pricing.vercel.app/sso/callback', 'asc-pricer'
FROM launcher_apps
WHERE rtrim(url, '/') = 'https://asc-pricing.vercel.app'
ON CONFLICT (app_id) DO UPDATE
  SET jwt_acs_url = EXCLUDED.jwt_acs_url,
      jwt_audience = EXCLUDED.jwt_audience;

-- Every app's audience should come back registered = true, active = true.
SELECT a.audience,
       c.app_id IS NOT NULL AS registered,
       l.name, l.status, l.sso_type
FROM (VALUES
  ('asc-pricer'), ('asc-engineering'), ('premium-engineering'), ('psb-pricing'),
  ('qsb-pricing'), ('bbd-helpdesk'), ('bbd-pm'), ('bbd-mbox-archive'),
  ('manufacturer-hub'), ('manufacturer-questions')
) AS a(audience)
LEFT JOIN launcher_sso_configs c ON c.jwt_audience = a.audience
LEFT JOIN launcher_apps l ON l.id = c.app_id
ORDER BY registered, a.audience;
