-- Extend audit log to also track important-link clicks alongside app launches.
-- Existing rows all have app_id set + link_id NULL, so the check constraint
-- is satisfied without a backfill.

ALTER TABLE launcher_sso_audit_log
  ALTER COLUMN app_id DROP NOT NULL;

ALTER TABLE launcher_sso_audit_log
  ADD COLUMN IF NOT EXISTS link_id UUID REFERENCES launcher_links(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_audit_log_link_id ON launcher_sso_audit_log(link_id);

ALTER TABLE launcher_sso_audit_log
  DROP CONSTRAINT IF EXISTS launcher_sso_audit_log_target_check;

ALTER TABLE launcher_sso_audit_log
  ADD CONSTRAINT launcher_sso_audit_log_target_check
  CHECK ((app_id IS NOT NULL) <> (link_id IS NOT NULL));
