-- Migration 70: company holidays — days the whole company is off.
-- Idempotent, one transaction. Apply in the Supabase SQL Editor for
-- xockuiyvxijuzlwlsfbu.
--
-- Managed by admins + managers in the launcher (/management/timeoff →
-- Holidays). A holiday never counts as a day off: every time-off day count
-- skips it, the same way it skips days a person isn't scheduled to work
-- (src/lib/timeoff/types.ts → countBusinessDays). Attendance also stops
-- treating a holiday with no clock-in as an absence.
--
--   company_holidays (id, holiday_date unique, name)
--
-- One row per date, company-wide. A two-day holiday is two rows. Dates that
-- move each year (Easter) are simply entered per year.

BEGIN;

CREATE TABLE IF NOT EXISTS company_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date DATE NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_holidays_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 80)
);

-- Service-role only: RLS on, no policies, nothing for anon / authenticated.
ALTER TABLE company_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON company_holidays FROM anon, authenticated;

-- Audit log (migration 060): who added or removed a holiday.
DROP TRIGGER IF EXISTS audit_capture ON company_holidays;
CREATE TRIGGER audit_capture AFTER INSERT OR UPDATE OR DELETE ON company_holidays
  FOR EACH ROW EXECUTE FUNCTION public.audit_capture('BBD Launcher', '');

COMMIT;

-- Check (expect one table with RLS on).
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'company_holidays';
