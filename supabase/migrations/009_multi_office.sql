-- Migration 9: Multi-office support for apps; add BST and RnD offices.
-- Apps move from a single `office TEXT` column to `offices TEXT[]` so an app
-- can be visible to multiple offices. Empty array = visible to everyone
-- (matches prior NULL semantics). Links remain single-office but gain BST/RnD.

-- 1. Add offices array to launcher_apps
ALTER TABLE launcher_apps
  ADD COLUMN IF NOT EXISTS offices TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 2. Backfill from the legacy single-value column (only on rows where it's set)
UPDATE launcher_apps
SET offices = ARRAY[office]
WHERE office IS NOT NULL
  AND (offices IS NULL OR array_length(offices, 1) IS NULL);

-- 3. Drop the legacy column on apps
ALTER TABLE launcher_apps DROP COLUMN IF EXISTS office;

-- 4. Constrain elements of offices to the allowed set
ALTER TABLE launcher_apps DROP CONSTRAINT IF EXISTS launcher_apps_offices_check;
ALTER TABLE launcher_apps ADD CONSTRAINT launcher_apps_offices_check
  CHECK (offices <@ ARRAY['Harbor','Marion','BST','RnD']::TEXT[]);

-- 5. Replace the single-value office index with a GIN index for array lookups
DROP INDEX IF EXISTS launcher_apps_office_idx;
CREATE INDEX IF NOT EXISTS launcher_apps_offices_idx
  ON launcher_apps USING GIN(offices);

-- 6. Loosen the links office check to allow the two new offices
ALTER TABLE launcher_links DROP CONSTRAINT IF EXISTS launcher_links_office_check;
ALTER TABLE launcher_links ADD CONSTRAINT launcher_links_office_check
  CHECK (office IS NULL OR office IN ('Harbor','Marion','BST','RnD'));
