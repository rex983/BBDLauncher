-- Migration 51: launcher-managed offices, departments and role permissions.
-- Idempotent, one transaction. Apply in the Supabase SQL Editor for
-- xockuiyvxijuzlwlsfbu.
--
-- Admins can now add offices, departments and roles in the launcher, and
-- every app on this shared database reads them from here:
--   launcher_offices      (name pk, display_name, sort_order) — seeded Sales, BST, RnD
--   launcher_departments  (name pk, display_name, sort_order) — seeded SALES TEAM, BST, RnD
--   launcher_roles.acts_as — the built-in role whose in-app permissions a
--                            custom role gets (one level, never 'admin',
--                            NULL = least privilege)
-- Names are immutable once created; only display_name / sort_order change.
--
-- The hardcoded office / department CHECK constraints (migrations 016, 038,
-- 039) are replaced by foreign keys (scalar columns) and triggers (the
-- launcher_apps.offices array and the access grid, which also allows 'none').
--
-- Helpers for every app (service_role only):
--   launcher_permission_role(role)  → coalesce(acts_as, name), NULL if unknown
--   launcher_app_members(audience)  → active profile ids that may open the app
-- and launcher_can_open_app (049) now reads the office list from
-- launcher_offices instead of a hardcoded one.
--
-- Not reversible by simply re-running 039: once admins add offices or
-- departments, the old CHECK lists would reject those rows.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Office and department lists.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS launcher_offices (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'none' is the access grid's "no office" row.
  CONSTRAINT launcher_offices_name_check
    CHECK (lower(name) <> 'none' AND name ~ '^[A-Za-z0-9]{2,30}$')
);

CREATE TABLE IF NOT EXISTS launcher_departments (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT launcher_departments_name_check
    CHECK (lower(name) <> 'none' AND name ~ '^[A-Za-z0-9]([A-Za-z0-9 ]{0,28}[A-Za-z0-9])?$')
);

-- Display names match what the launcher showed before (the access grid
-- labelled RnD "R&D"; departments were shown as their raw names).
INSERT INTO launcher_offices (name, display_name, sort_order) VALUES
  ('Sales', 'Sales', 10),
  ('BST',   'BST',   20),
  ('RnD',   'R&D',   30)
ON CONFLICT (name) DO NOTHING;

INSERT INTO launcher_departments (name, display_name, sort_order) VALUES
  ('SALES TEAM', 'SALES TEAM', 10),
  ('BST',        'BST',        20),
  ('RnD',        'RnD',        30)
ON CONFLICT (name) DO NOTHING;

-- Service-role only: RLS on, no policies.
ALTER TABLE launcher_offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_departments ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Roles: acts_as.
-- ---------------------------------------------------------------------------
ALTER TABLE launcher_roles ADD COLUMN IF NOT EXISTS acts_as TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'launcher_roles_acts_as_fkey') THEN
    ALTER TABLE launcher_roles
      ADD CONSTRAINT launcher_roles_acts_as_fkey FOREIGN KEY (acts_as)
      REFERENCES launcher_roles(name) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE launcher_roles DROP CONSTRAINT IF EXISTS launcher_roles_acts_as_check;
ALTER TABLE launcher_roles ADD CONSTRAINT launcher_roles_acts_as_check
  CHECK (acts_as IS NULL OR (acts_as <> 'admin' AND acts_as <> name));

-- The roles app code gives a meaning to. Only these can be an acts_as
-- target, and they can't have acts_as themselves (that would silently change
-- everyone already on them). Mirrored in src/lib/auth/permissions.ts
-- (BUILTIN_ROLES).
CREATE OR REPLACE FUNCTION public.launcher_builtin_roles()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['admin', 'senior_manager', 'junior_manager', 'team_lead', 'sales_rep',
               'bst', 'rnd', 'cancellations_dept', 'revisions_dept']::text[];
$$;

CREATE OR REPLACE FUNCTION public.launcher_roles_acts_as_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.acts_as IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.is_admin THEN
    RAISE EXCEPTION 'An admin role cannot act as another role' USING ERRCODE = '23514';
  END IF;
  IF NEW.name = ANY (launcher_builtin_roles()) THEN
    RAISE EXCEPTION 'Built-in role "%" cannot act as another role', NEW.name USING ERRCODE = '23514';
  END IF;
  IF NOT (NEW.acts_as = ANY (launcher_builtin_roles())) OR NEW.acts_as = 'admin' THEN
    RAISE EXCEPTION 'acts_as must be a built-in role other than admin (got "%")', NEW.acts_as
      USING ERRCODE = '23514';
  END IF;
  -- One level: the target must not itself act as something (built-ins never
  -- do, but check the row rather than trust the list).
  IF EXISTS (SELECT 1 FROM launcher_roles r WHERE r.name = NEW.acts_as AND r.acts_as IS NOT NULL) THEN
    RAISE EXCEPTION 'Role "%" acts as another role; acts_as is one level only', NEW.acts_as
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM launcher_roles r WHERE r.acts_as = NEW.name) THEN
    RAISE EXCEPTION 'Other roles act as "%"; acts_as is one level only', NEW.name
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS launcher_roles_acts_as_guard ON launcher_roles;
CREATE TRIGGER launcher_roles_acts_as_guard
  BEFORE INSERT OR UPDATE OF acts_as, name, is_admin ON launcher_roles
  FOR EACH ROW EXECUTE FUNCTION launcher_roles_acts_as_guard();

-- ---------------------------------------------------------------------------
-- 3. Replace the hardcoded office / department CHECKs.
-- ---------------------------------------------------------------------------
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_office_check;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_department_check;
ALTER TABLE launcher_links DROP CONSTRAINT IF EXISTS launcher_links_office_check;
ALTER TABLE launcher_apps DROP CONSTRAINT IF EXISTS launcher_apps_offices_check;
ALTER TABLE launcher_role_app_access DROP CONSTRAINT IF EXISTS launcher_role_app_access_office_check;
-- office_memos.audience_office / audience_department never had a CHECK; the
-- memo API validates them against the lists. Left unconstrained so archived
-- memos keep the names they were sent with.

-- Scalar columns → foreign keys. Added NOT VALID (no table scan under lock),
-- then validated below only if no row would fail.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_office_fkey') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_office_fkey FOREIGN KEY (office)
      REFERENCES launcher_offices(name) ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_department_fkey') THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_department_fkey FOREIGN KEY (department)
      REFERENCES launcher_departments(name) ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'launcher_links_office_fkey') THEN
    ALTER TABLE launcher_links ADD CONSTRAINT launcher_links_office_fkey FOREIGN KEY (office)
      REFERENCES launcher_offices(name) ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

DO $$
DECLARE
  bad TEXT;
BEGIN
  SELECT string_agg(DISTINCT office, ', ') INTO bad
  FROM profiles p
  WHERE office IS NOT NULL AND NOT EXISTS (SELECT 1 FROM launcher_offices o WHERE o.name = p.office);
  IF bad IS NULL THEN
    ALTER TABLE profiles VALIDATE CONSTRAINT profiles_office_fkey;
  ELSE
    RAISE NOTICE 'profiles_office_fkey left NOT VALID — unknown profiles.office values: %', bad;
  END IF;

  SELECT string_agg(DISTINCT department, ', ') INTO bad
  FROM profiles p
  WHERE department IS NOT NULL AND NOT EXISTS (SELECT 1 FROM launcher_departments d WHERE d.name = p.department);
  IF bad IS NULL THEN
    ALTER TABLE profiles VALIDATE CONSTRAINT profiles_department_fkey;
  ELSE
    RAISE NOTICE 'profiles_department_fkey left NOT VALID — unknown profiles.department values: %', bad;
  END IF;

  SELECT string_agg(DISTINCT office, ', ') INTO bad
  FROM launcher_links l
  WHERE office IS NOT NULL AND NOT EXISTS (SELECT 1 FROM launcher_offices o WHERE o.name = l.office);
  IF bad IS NULL THEN
    ALTER TABLE launcher_links VALIDATE CONSTRAINT launcher_links_office_fkey;
  ELSE
    RAISE NOTICE 'launcher_links_office_fkey left NOT VALID — unknown launcher_links.office values: %', bad;
  END IF;
END $$;

-- Array / 'none' columns → triggers.
CREATE OR REPLACE FUNCTION public.launcher_check_access_office()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.office IS NOT NULL AND NEW.office <> 'none'
     AND NOT EXISTS (SELECT 1 FROM launcher_offices o WHERE o.name = NEW.office) THEN
    RAISE EXCEPTION 'Unknown office "%"', NEW.office USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS launcher_role_app_access_office_check ON launcher_role_app_access;
CREATE TRIGGER launcher_role_app_access_office_check
  BEFORE INSERT OR UPDATE OF office ON launcher_role_app_access
  FOR EACH ROW EXECUTE FUNCTION launcher_check_access_office();

CREATE OR REPLACE FUNCTION public.launcher_check_app_offices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bad TEXT;
BEGIN
  SELECT string_agg(COALESCE(x.o, 'NULL'), ', ') INTO bad
  FROM unnest(COALESCE(NEW.offices, '{}'::text[])) AS x(o)
  WHERE x.o IS NULL OR NOT EXISTS (SELECT 1 FROM launcher_offices lo WHERE lo.name = x.o);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown office(s): %', bad USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS launcher_apps_offices_check ON launcher_apps;
CREATE TRIGGER launcher_apps_offices_check
  BEFORE INSERT OR UPDATE OF offices ON launcher_apps
  FOR EACH ROW EXECUTE FUNCTION launcher_check_app_offices();

-- The trigger-checked columns have no FK, so refuse deleting / renaming an
-- office they still use (profiles and links are covered by their FKs).
CREATE OR REPLACE FUNCTION public.launcher_offices_in_use_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.name = OLD.name THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM launcher_role_app_access a WHERE a.office = OLD.name)
     OR EXISTS (SELECT 1 FROM launcher_apps a WHERE OLD.name = ANY (a.offices)) THEN
    RAISE EXCEPTION 'Office "%" is still used by app access', OLD.name USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS launcher_offices_in_use_guard ON launcher_offices;
CREATE TRIGGER launcher_offices_in_use_guard
  BEFORE DELETE OR UPDATE OF name ON launcher_offices
  FOR EACH ROW EXECUTE FUNCTION launcher_offices_in_use_guard();

-- Trigger functions are never called directly.
REVOKE ALL ON FUNCTION public.launcher_roles_acts_as_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.launcher_check_access_office() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.launcher_check_app_offices() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.launcher_offices_in_use_guard() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Shared helpers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.launcher_permission_role(p_role text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(r.acts_as, r.name) FROM launcher_roles r WHERE r.name = p_role;
$$;

REVOKE ALL ON FUNCTION public.launcher_permission_role(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.launcher_permission_role(text) TO service_role;

-- 049's rule with launcher_offices as the office list.
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
           CASE WHEN EXISTS (SELECT 1 FROM launcher_offices o WHERE o.name = p.office)
                THEN p.office ELSE 'none' END AS office_row
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

-- Everyone launcher_can_open_app(id, p_audience) says true for, in one pass.
-- Empty when no active app has that audience.
CREATE OR REPLACE FUNCTION public.launcher_app_members(p_audience text)
RETURNS SETOF uuid
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
    SELECT p.id, p.role, p.office, COALESCE(o.name, 'none') AS office_row
    FROM profiles p
    LEFT JOIN launcher_offices o ON o.name = p.office
    WHERE COALESCE(p.is_active, true)
  )
  SELECT person.id
  FROM app CROSS JOIN person
  WHERE EXISTS (
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
        );
$$;

REVOKE ALL ON FUNCTION public.launcher_app_members(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.launcher_app_members(text) TO service_role;

COMMIT;

-- Check (expect: 3 offices, 3 departments, the FKs validated).
SELECT
  (SELECT count(*) FROM launcher_offices)     AS offices,
  (SELECT count(*) FROM launcher_departments) AS departments,
  (SELECT string_agg(conname || '=' || convalidated, ', ')
     FROM pg_constraint
    WHERE conname IN ('profiles_office_fkey', 'profiles_department_fkey', 'launcher_links_office_fkey')) AS fks;
