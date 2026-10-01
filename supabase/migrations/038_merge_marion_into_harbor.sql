-- Migration 38: the Marion office closes; everyone there moves to Harbor.
-- BST and RnD stay separate offices.
--
-- Runs in one transaction across every app's office data in this shared
-- DB, so nobody is ever half-moved (e.g. office = Harbor but app grants
-- still Marion-only). "Merge" = Harbor gets the union of both offices'
-- access, so no ex-Marion user loses an app or pricing region.
--
-- Historical analytics (mfr_hub_event.office) keep 'Marion' on purpose.

BEGIN;

-- ---------------------------------------------------------------------
-- Launcher: app access grid. Every Marion grant becomes a Harbor grant
-- (skipped when the role already has Harbor or all-offices access).
-- ---------------------------------------------------------------------
INSERT INTO launcher_role_app_access (role_name, app_id, office)
SELECT DISTINCT m.role_name, m.app_id, 'Harbor'
FROM launcher_role_app_access m
WHERE m.office = 'Marion'
  AND NOT EXISTS (
    SELECT 1 FROM launcher_role_app_access h
    WHERE h.role_name = m.role_name
      AND h.app_id = m.app_id
      AND (h.office = 'Harbor' OR h.office IS NULL)
  );

DELETE FROM launcher_role_app_access WHERE office = 'Marion';

-- Legacy per-app office list (still a second gate in /dashboard + /api/launch).
UPDATE launcher_apps
SET offices = ARRAY(
  SELECT DISTINCT unnest(array_replace(offices, 'Marion', 'Harbor'))
)
WHERE 'Marion' = ANY(offices);

UPDATE launcher_links SET office = 'Harbor' WHERE office = 'Marion';
UPDATE office_memos SET audience_office = 'Harbor' WHERE audience_office = 'Marion';

-- ---------------------------------------------------------------------
-- PSB Pricing: regions are gated by office (North had Marion, not Harbor).
-- ---------------------------------------------------------------------
UPDATE psb_regions
SET offices = ARRAY(
  SELECT DISTINCT unnest(array_replace(offices, 'Marion', 'Harbor'))
)
WHERE 'Marion' = ANY(offices);

-- ---------------------------------------------------------------------
-- ASC Pricer: office-stamped records (empty today; kept for safety).
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['asc_customers', 'asc_quotes', 'asc_sales_reps'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('UPDATE %I SET office = %L WHERE office = %L', t, 'Harbor', 'Marion');
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- People. Bump session_version so every app (incl. QSB / Quality
-- Accessories, which only re-read on a version change) refreshes the
-- office claim on the next request instead of carrying 'Marion'.
-- ---------------------------------------------------------------------
UPDATE profiles
SET office = 'Harbor',
    session_version = COALESCE(session_version, 1) + 1
WHERE office = 'Marion';

-- ---------------------------------------------------------------------
-- Retire 'Marion' as a valid value so nothing can recreate it.
-- ---------------------------------------------------------------------
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_office_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_office_check
  CHECK (office IS NULL OR office IN ('Harbor', 'BST', 'RnD'));

ALTER TABLE launcher_apps DROP CONSTRAINT IF EXISTS launcher_apps_offices_check;
ALTER TABLE launcher_apps ADD CONSTRAINT launcher_apps_offices_check
  CHECK (offices <@ ARRAY['Harbor','BST','RnD']::TEXT[]);

ALTER TABLE launcher_links DROP CONSTRAINT IF EXISTS launcher_links_office_check;
ALTER TABLE launcher_links ADD CONSTRAINT launcher_links_office_check
  CHECK (office IS NULL OR office IN ('Harbor','BST','RnD'));

ALTER TABLE launcher_role_app_access DROP CONSTRAINT IF EXISTS launcher_role_app_access_office_check;
ALTER TABLE launcher_role_app_access ADD CONSTRAINT launcher_role_app_access_office_check
  CHECK (office IS NULL OR office IN ('Harbor', 'BST', 'RnD', 'none'));

COMMIT;
