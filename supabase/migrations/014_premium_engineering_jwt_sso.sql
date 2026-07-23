-- Migration 14: enable JWT-SSO for Premium Engineering tile
--
-- Flips the launcher_apps row to sso_type='jwt' and inserts the matching
-- launcher_sso_configs row. Verifier on the PSE side expects
--   issuer   = "bbd-launcher"
--   audience = "premium-engineering"
-- ACS URL is the SSO callback page in PSE.

UPDATE launcher_apps
SET sso_type = 'jwt'
WHERE url = 'https://premium-engineering.vercel.app';

INSERT INTO launcher_sso_configs (app_id, jwt_acs_url, jwt_audience)
SELECT
  id,
  'https://premium-engineering.vercel.app/sso/callback',
  'premium-engineering'
FROM launcher_apps
WHERE url = 'https://premium-engineering.vercel.app'
ON CONFLICT (app_id) DO UPDATE
  SET jwt_acs_url = EXCLUDED.jwt_acs_url,
      jwt_audience = EXCLUDED.jwt_audience;
