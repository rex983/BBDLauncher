-- Migration 71: a holiday can belong to one person.
-- Idempotent, one transaction. Apply in the Supabase SQL Editor for
-- xockuiyvxijuzlwlsfbu.
--
-- company_holidays.profile_id: NULL = the whole company (every row so far);
-- set = a holiday for that person only, a normal day for everyone else.
-- Day counts and attendance use the company-wide rows plus the person's own
-- (src/lib/timeoff/holidays.ts → holidaysFor).
--
-- One company-wide holiday per date, and one per person per date. A person
-- may have their own holiday on a date that is also a company holiday.
--
-- Also adds the first personal holiday: Muay Thai Day (Feb 6) for Brandyn.

BEGIN;

ALTER TABLE company_holidays
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE company_holidays DROP CONSTRAINT IF EXISTS company_holidays_holiday_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS company_holidays_everyone_key
  ON company_holidays (holiday_date) WHERE profile_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS company_holidays_person_key
  ON company_holidays (holiday_date, profile_id) WHERE profile_id IS NOT NULL;

INSERT INTO company_holidays (holiday_date, name, profile_id, created_by)
SELECT d, 'Muay Thai Day', p.id, p.id
FROM profiles p, (VALUES (DATE '2027-02-06'), (DATE '2028-02-06')) AS v(d)
WHERE p.id = '863fd88f-f86d-45c3-b652-260cbbfd92c4'
ON CONFLICT (holiday_date, profile_id) WHERE profile_id IS NOT NULL DO NOTHING;

COMMIT;

-- Check (expect the Muay Thai Day rows, each with a profile_id).
SELECT holiday_date, name, profile_id FROM company_holidays WHERE profile_id IS NOT NULL ORDER BY holiday_date;
