-- Migration 32: split the incident report body into three semantic sections.
--
-- Product wanted the filing form separated into:
--   1. Problem       — visible to employee
--   2. Proposed solution & deadline — visible to employee
--   3. Manager notes — private, never shown to employee
--
-- The signed `document` field stays as the source of truth for the hash
-- chain (still what employees see and sign) but is now composed from
-- problem + proposed_solution server-side rather than typed as a single
-- blob. manager_notes lives out-of-band on the row so it can only reach
-- managers.
--
-- All three columns are nullable so legacy rows filed before this
-- migration keep rendering (they only have `document` populated).

ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS problem            TEXT,
  ADD COLUMN IF NOT EXISTS proposed_solution  TEXT,
  ADD COLUMN IF NOT EXISTS manager_notes      TEXT;
