-- Migration 23: expand time_off_requests to match the Google Form retired
-- by this feature.
--
-- Changes:
--   * Add 'parental' to the type check constraint so parental leave has a
--     first-class category (previously buried under 'other').
--   * Add a `subcategory` text column for the second-level reason picker
--     (e.g., "Short-term illness", "Planned vacations", "Family emergencies").
--     Nullable — 'other' type has no subcategory, and old rows have none.
--
-- No data migration: the app treats missing subcategory as "—".

ALTER TABLE time_off_requests
  DROP CONSTRAINT IF EXISTS time_off_requests_type_check;

ALTER TABLE time_off_requests
  ADD CONSTRAINT time_off_requests_type_check
  CHECK (type IN ('vacation', 'sick', 'personal', 'parental', 'other'));

ALTER TABLE time_off_requests
  ADD COLUMN IF NOT EXISTS subcategory TEXT;
