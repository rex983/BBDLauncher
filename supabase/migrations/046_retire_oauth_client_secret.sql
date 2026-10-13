-- Migration 46: retire the half-built OAuth sign-on type.
--
-- The launcher never implemented an OAuth callback (/api/oauth/callback did
-- not exist), and the app form / API no longer accept sso_type = 'oauth'.
-- The only sensitive leftover is launcher_sso_configs.oauth_client_secret,
-- which was sent to admins' browsers with the rest of the SSO config.
--
-- Defensive: the column is dropped only when no app still uses
-- sso_type = 'oauth'. If one does, the secret stays and a NOTICE says so —
-- switch that app to another sign-on type and re-run this migration.
--
-- The 'oauth' value stays in the sso_type enum (Postgres can't drop enum
-- values without rebuilding the type); the other oauth_* columns are
-- non-secret and left in place.

DO $$
DECLARE
  oauth_apps INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'launcher_sso_configs'
      AND column_name = 'oauth_client_secret'
  ) THEN
    RAISE NOTICE 'oauth_client_secret already gone — nothing to do';
    RETURN;
  END IF;

  SELECT count(*) INTO oauth_apps
  FROM launcher_apps
  WHERE sso_type::text = 'oauth';

  IF oauth_apps > 0 THEN
    RAISE NOTICE '% app(s) still use sso_type = oauth — leaving oauth_client_secret in place', oauth_apps;
  ELSE
    ALTER TABLE launcher_sso_configs DROP COLUMN IF EXISTS oauth_client_secret;
  END IF;
END $$;
