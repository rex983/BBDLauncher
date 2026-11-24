-- Migration 71: holidays that come back every year.
-- Idempotent, one transaction. Apply in the Supabase SQL Editor for
-- xockuiyvxijuzlwlsfbu.
--
-- company_holidays.recurrence says how a holiday repeats, read off its own
-- holiday_date (src/lib/timeoff/holidays.ts → occurrenceIn):
--
--   none          one time, that date only (every row so far)
--   date          the same month and day every year          (Dec 25)
--   weekday       the same nth weekday of the month          (4th Thu of Nov)
--   last_weekday  the last such weekday of the month         (last Mon of May)
--   easter        the same number of days from Easter Sunday
--
-- A yearly holiday applies from the year of its holiday_date onward, never
-- to earlier years, so adding one does not change past day counts.
--
-- Also turns the holidays entered so far into yearly ones and drops the
-- 2027 Thanksgiving / Christmas rows the yearly rules now cover.

BEGIN;

ALTER TABLE company_holidays
  ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none';

ALTER TABLE company_holidays DROP CONSTRAINT IF EXISTS company_holidays_recurrence_check;
ALTER TABLE company_holidays ADD CONSTRAINT company_holidays_recurrence_check
  CHECK (recurrence IN ('none', 'date', 'weekday', 'last_weekday', 'easter'));

UPDATE company_holidays SET recurrence = 'weekday'
  WHERE holiday_date = DATE '2026-11-26' AND name = 'Thanksgiving';
UPDATE company_holidays SET recurrence = 'date'
  WHERE holiday_date = DATE '2026-12-25' AND name = 'Christmas';
UPDATE company_holidays SET recurrence = 'date'
  WHERE holiday_date = DATE '2027-01-01' AND name = 'New Year''s Day';
UPDATE company_holidays SET recurrence = 'easter'
  WHERE holiday_date = DATE '2027-03-28' AND name = 'Easter';
UPDATE company_holidays SET recurrence = 'date'
  WHERE holiday_date = DATE '2027-07-04' AND name = 'Independence Day';

DELETE FROM company_holidays
  WHERE recurrence = 'none'
    AND ((holiday_date = DATE '2027-11-25' AND name = 'Thanksgiving')
      OR (holiday_date = DATE '2027-12-25' AND name = 'Christmas'));

COMMIT;

-- Check (expect five rows, each yearly).
SELECT holiday_date, name, recurrence FROM company_holidays ORDER BY holiday_date;
