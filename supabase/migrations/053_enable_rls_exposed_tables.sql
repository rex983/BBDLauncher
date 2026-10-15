-- Migration 053: close tables that the public anon key could read.
--
-- Found 2026-10-15: these tables had row level security OFF, so anyone with
-- the anon key (it ships in every app's browser bundle) could read them over
-- the REST API, including QSB customer names/emails/addresses, login
-- attempts and audit logs with IPs.
--
-- Every app reads and writes them only through its server-side service-role
-- client (which bypasses RLS), so enabling RLS with no policies blocks the
-- anon/authenticated roles and changes nothing for the apps.
--
-- Shared DB xockuiyvxijuzlwlsfbu. Idempotent. Apply in the SQL Editor.

BEGIN;

-- Every QSB table, present and future-proofed against ones not listed here.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'qsb\_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

ALTER TABLE public.asc_audit_log                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asc_app_config               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launcher_motivational_quotes ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Anything in public still without RLS (should be empty; if not, check
-- whether that table holds anything the public should not read).
SELECT tablename AS still_without_rls
FROM pg_tables
WHERE schemaname = 'public' AND NOT rowsecurity
ORDER BY 1;
