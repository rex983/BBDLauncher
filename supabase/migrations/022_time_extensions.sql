-- Migration 22: End-of-shift extensions + 'auto' punch source.
--
-- time_extensions: an employee's answer to the "you're about to clock out"
-- prompt. One row per (profile_id, date) — the latest wins. The auto-clockout
-- cron reads this to decide when to fire clock_out.
--
-- source='auto' identifies clockouts inserted by /api/cron/auto-clockout so
-- they're visually distinguishable from user-driven punches.

ALTER TABLE time_punches
  DROP CONSTRAINT IF EXISTS time_punches_source_check;

ALTER TABLE time_punches
  ADD CONSTRAINT time_punches_source_check
  CHECK (source IN ('web', 'desktop', 'admin_edit', 'auto'));

CREATE TABLE IF NOT EXISTS time_extensions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  local_date        DATE NOT NULL,
  extension_until   TIMESTAMPTZ NOT NULL,
  requested_minutes INT NOT NULL CHECK (requested_minutes > 0 AND requested_minutes <= 480),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, local_date)
);

CREATE INDEX IF NOT EXISTS idx_time_extensions_profile_date
  ON time_extensions (profile_id, local_date DESC);

CREATE INDEX IF NOT EXISTS idx_time_extensions_until
  ON time_extensions (extension_until);

DROP TRIGGER IF EXISTS trg_time_extensions_updated_at ON time_extensions;
CREATE TRIGGER trg_time_extensions_updated_at
  BEFORE UPDATE ON time_extensions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE time_extensions ENABLE ROW LEVEL SECURITY;
