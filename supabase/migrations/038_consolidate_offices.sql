-- Migration 38: consolidate offices. The valid offices are exactly Harbor,
-- BST and RnD; any other office value is folded into Harbor.
--
-- Runs in one transaction across every app's office data in this shared
-- DB, so nobody is ever half-moved. Harbor receives the union of the
-- folded office's access, so no one loses an app or pricing region.

BEGIN;

-- Launcher: app access grid.
INSERT INTO launcher_role_app_access (role_name, app_id, office)
SELECT DISTINCT m.role_name, m.app_id, 'Harbor'
FROM launcher_role_app_access m
WHERE m.office NOT IN ('Harbor', 'BST', 'RnD', 'none')
  AND NOT EXISTS (
    SELECT 1 FROM launcher_role_app_access h
    WHERE h.role_name = m.role_name
      AND h.app_id = m.app_id
      AND (h.office = 'Harbor' OR h.office IS NULL)
  );
DELETE FROM launcher_role_app_access WHERE office NOT IN ('Harbor', 'BST', 'RnD', 'none');

-- Legacy per-app office list (second gate in /dashboard + /api/launch).
UPDATE launcher_apps
SET offices = ARRAY(
  SELECT DISTINCT CASE WHEN o IN ('Harbor', 'BST', 'RnD') THEN o ELSE 'Harbor' END
  FROM unnest(offices) AS o
)
WHERE NOT offices <@ ARRAY['Harbor', 'BST', 'RnD']::TEXT[];

UPDATE launcher_links SET office = 'Harbor' WHERE office NOT IN ('Harbor', 'BST', 'RnD');
UPDATE office_memos SET audience_office = 'Harbor' WHERE audience_office NOT IN ('Harbor', 'BST', 'RnD');

-- PSB Pricing: regions are gated by office.
UPDATE psb_regions
SET offices = ARRAY(
  SELECT DISTINCT CASE WHEN o IN ('Harbor', 'BST', 'RnD') THEN o ELSE 'Harbor' END
  FROM unnest(offices) AS o
)
WHERE NOT offices <@ ARRAY['Harbor', 'BST', 'RnD']::TEXT[];

-- ASC Pricer: office-stamped records.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['asc_customers', 'asc_quotes', 'asc_sales_reps'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format(
        'UPDATE %I SET office = %L WHERE office NOT IN (%L, %L, %L)',
        t, 'Harbor', 'Harbor', 'BST', 'RnD'
      );
    END IF;
  END LOOP;
END $$;

-- People. Bump session_version so every app (incl. QSB / Quality
-- Accessories, which only re-read on a version change) refreshes the
-- office claim on the next request.
UPDATE profiles
SET office = 'Harbor',
    session_version = COALESCE(session_version, 1) + 1
WHERE office NOT IN ('Harbor', 'BST', 'RnD');

-- Only the three offices are valid from here on.
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
