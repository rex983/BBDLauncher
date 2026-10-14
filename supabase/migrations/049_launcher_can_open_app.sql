-- Migration 49: one access rule for every app.
-- Idempotent. Apply in the Supabase SQL Editor for xockuiyvxijuzlwlsfbu.
--
-- launcher_can_open_app(profile, audience) answers "may this person use the
-- app registered with this JWT audience?" with the same rule the launcher's
-- launch gate (src/lib/launcher/launch-gate.ts) and dashboard use:
--   * the person exists and is active
--   * a per-person grant (launcher_user_access, migration 040), or
--   * an office × role grid row (migration 034): office NULL = every office,
--     'none' = people with no office; admins need an admin row but skip office
--   * plus the legacy launcher_apps.offices list (skipped for grants/admins)
-- The clock-in gate is not part of it — that only applies at launch time.
--
-- Returns NULL when no active app has that audience, so an app that isn't
-- registered yet can fail open instead of locking everyone out.
-- Consumer apps call it at sign-in and on their 60s session recheck.

CREATE OR REPLACE FUNCTION public.launcher_can_open_app(p_profile_id uuid, p_audience text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH app AS (
    SELECT a.id, COALESCE(a.offices, '{}') AS offices
    FROM launcher_apps a
    JOIN launcher_sso_configs c ON c.app_id = a.id
    WHERE c.jwt_audience = p_audience AND a.status = 'active'
    LIMIT 1
  ),
  person AS (
    SELECT p.id, p.role, p.office,
           CASE WHEN p.office IN ('Sales', 'BST', 'RnD') THEN p.office ELSE 'none' END AS office_row
    FROM profiles p
    WHERE p.id = p_profile_id AND COALESCE(p.is_active, true)
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM app) THEN NULL
    WHEN NOT EXISTS (SELECT 1 FROM person) THEN false
    ELSE (
      SELECT
        EXISTS (
          SELECT 1 FROM launcher_user_access u
          WHERE u.profile_id = person.id AND u.app_id = app.id
        )
        OR (
          EXISTS (
            SELECT 1 FROM launcher_role_app_access r
            WHERE r.app_id = app.id
              AND r.role_name = person.role
              AND (person.role = 'admin' OR r.office IS NULL OR r.office = person.office_row)
          )
          AND (
            person.role = 'admin'
            OR cardinality(app.offices) = 0
            OR person.office = ANY (app.offices)
          )
        )
      FROM app, person
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.launcher_can_open_app(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.launcher_can_open_app(uuid, text) TO service_role;
