-- Migration 054: actually close the tables 053 targeted.
--
-- 053 enabled RLS, but these tables already carry permissive policies
-- (e.g. USING (true)), so the anon key could still read them. Revoking the
-- table privileges from anon/authenticated blocks REST and Realtime reads
-- regardless of policies. Every app uses the service role (unaffected).
--
-- Shared DB xockuiyvxijuzlwlsfbu. Idempotent. Apply in the SQL Editor.

BEGIN;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND (tablename LIKE 'qsb\_%'
           OR tablename IN ('asc_audit_log', 'asc_app_config', 'launcher_motivational_quotes'))
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

COMMIT;

-- The permissive policies that let anon in (for the record; now inert).
SELECT tablename, policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND (tablename LIKE 'qsb\_%'
       OR tablename IN ('asc_audit_log', 'asc_app_config', 'launcher_motivational_quotes'))
ORDER BY 1, 2;
