-- Migration 39: the Harbor office is renamed "Sales". Offices are now
-- Sales, BST and RnD.
--
-- One transaction across every app's LIVE office data in this shared DB.
-- History is deliberately untouched: mfr_hub_event.office (analytics),
-- offboarding_cases.employee_office (snapshot), audit logs, and the mbox
-- archive keep the name they were recorded with.

BEGIN;

-- Drop the office CHECKs first so the renamed value can be written.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_office_check;
ALTER TABLE launcher_apps DROP CONSTRAINT IF EXISTS launcher_apps_offices_check;
ALTER TABLE launcher_links DROP CONSTRAINT IF EXISTS launcher_links_office_check;
ALTER TABLE launcher_role_app_access DROP CONSTRAINT IF EXISTS launcher_role_app_access_office_check;

-- People. Bump session_version so every app refreshes the office claim on
-- the next request.
UPDATE profiles
SET office = 'Sales',
    session_version = COALESCE(session_version, 1) + 1
WHERE office = 'Harbor';

-- Launcher.
UPDATE launcher_role_app_access SET office = 'Sales' WHERE office = 'Harbor';
UPDATE launcher_apps SET offices = array_replace(offices, 'Harbor', 'Sales') WHERE 'Harbor' = ANY(offices);
UPDATE launcher_links SET office = 'Sales' WHERE office = 'Harbor';
UPDATE office_memos SET audience_office = 'Sales' WHERE audience_office = 'Harbor';

-- PSB Pricing regions.
UPDATE psb_regions SET offices = array_replace(offices, 'Harbor', 'Sales') WHERE 'Harbor' = ANY(offices);

-- ASC Pricer office-stamped records.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['asc_customers', 'asc_quotes', 'asc_sales_reps'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('UPDATE %I SET office = %L WHERE office = %L', t, 'Sales', 'Harbor');
    END IF;
  END LOOP;
END $$;

-- Manufacturer Hub visibility tokens: "Harbor", "office:Harbor",
-- "cell:Harbor|role", and section-prefixed forms ("key@…").
UPDATE mfr_hub_page
SET hidden_offices = ARRAY(
  SELECT regexp_replace(t, '(^|[:@])Harbor($|\|)', '\1Sales\2') FROM unnest(hidden_offices) AS t
)
WHERE array_to_string(hidden_offices, ',') LIKE '%Harbor%';

UPDATE mfr_hub_coverage_zone
SET hidden_audience = ARRAY(
  SELECT regexp_replace(t, '(^|[:@])Harbor($|\|)', '\1Sales\2') FROM unnest(hidden_audience) AS t
)
WHERE array_to_string(hidden_audience, ',') LIKE '%Harbor%';

UPDATE mfr_hub_manufacturer
SET hidden_sections = ARRAY(
  SELECT regexp_replace(t, '(^|[:@])Harbor($|\|)', '\1Sales\2') FROM unnest(hidden_sections) AS t
)
WHERE array_to_string(hidden_sections, ',') LIKE '%Harbor%';

-- Re-add the CHECKs with the new name.
ALTER TABLE profiles ADD CONSTRAINT profiles_office_check
  CHECK (office IS NULL OR office IN ('Sales', 'BST', 'RnD'));
ALTER TABLE launcher_apps ADD CONSTRAINT launcher_apps_offices_check
  CHECK (offices <@ ARRAY['Sales','BST','RnD']::TEXT[]);
ALTER TABLE launcher_links ADD CONSTRAINT launcher_links_office_check
  CHECK (office IS NULL OR office IN ('Sales','BST','RnD'));
ALTER TABLE launcher_role_app_access ADD CONSTRAINT launcher_role_app_access_office_check
  CHECK (office IS NULL OR office IN ('Sales', 'BST', 'RnD', 'none'));

COMMIT;

-- Anything still saying Harbor outside the history tables (expect no rows).
WITH cols AS (
  SELECT table_schema, table_name, column_name
  FROM information_schema.columns c
  JOIN information_schema.tables t USING (table_schema, table_name)
  WHERE c.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND c.data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
    AND c.table_name NOT LIKE 'mbox\_%'
    AND c.table_name NOT IN ('mfr_hub_event', 'offboarding_cases', 'offboarding_events',
                             'incident_report_events', 'office_memo_events', 'launcher_sso_audit_log')
)
SELECT location, n FROM (
  SELECT format('%I.%I', table_name, column_name) AS location,
         (xpath('/row/n/text()', query_to_xml(format(
           'SELECT count(*) AS n FROM %I.%I WHERE %I::text LIKE %L',
           table_schema, table_name, column_name, '%Harbor%'
         ), false, true, '')))[1]::text::int AS n
  FROM cols
) s WHERE n > 0;
