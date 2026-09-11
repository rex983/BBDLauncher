-- Migration 19: Timesheet + time-off scaffolding for the /management area.
--
-- Adds three tables:
--   * time_punches       — flat event log (clock_in/out, lunch_start/end, break_start/end).
--   * work_schedules     — per-user weekday hour overrides (absence => default 10:00-18:00 ET).
--   * time_off_requests  — vacation / sick / personal requests + approval status.
--
-- Balances (accrual, PTO totals) are intentionally deferred — v1 is
-- request-and-approve only. RLS mirrors the launcher's existing pattern:
-- service-role writes from Next API routes, plus a read policy so managers
-- can list within office scope directly if needed later.

-- =====================================================================
-- time_punches — flat event log. Sessions and totals are derived.
-- =====================================================================
CREATE TABLE IF NOT EXISTS time_punches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK (event_type IN (
                   'clock_in', 'clock_out',
                   'lunch_start', 'lunch_end',
                   'break_start', 'break_end'
                 )),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source        TEXT NOT NULL DEFAULT 'web'
                   CHECK (source IN ('web', 'desktop', 'admin_edit')),
  edited_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_punches_profile_occurred
  ON time_punches (profile_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_punches_occurred
  ON time_punches (occurred_at DESC);

-- =====================================================================
-- work_schedules — per-user, per-weekday hour overrides.
-- weekday: 0 = Sunday .. 6 = Saturday (matches JS Date.getDay()).
-- =====================================================================
CREATE TABLE IF NOT EXISTS work_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  weekday       SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'America/New_York',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, weekday)
);

CREATE INDEX IF NOT EXISTS idx_work_schedules_profile
  ON work_schedules (profile_id);

-- =====================================================================
-- time_off_requests — v1: request + approve. Balances deferred.
-- =====================================================================
CREATE TABLE IF NOT EXISTS time_off_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('vacation', 'sick', 'personal', 'other')),
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  full_day      BOOLEAN NOT NULL DEFAULT TRUE,
  hours         NUMERIC(5,2),
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  decided_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  decided_note  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date),
  CHECK (full_day OR hours IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_time_off_requests_profile
  ON time_off_requests (profile_id, start_date DESC);

CREATE INDEX IF NOT EXISTS idx_time_off_requests_status
  ON time_off_requests (status, start_date);

-- updated_at trigger — reuse pattern from earlier migrations if it exists,
-- otherwise inline a lightweight version.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_work_schedules_updated_at ON work_schedules;
CREATE TRIGGER trg_work_schedules_updated_at
  BEFORE UPDATE ON work_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_time_off_requests_updated_at ON time_off_requests;
CREATE TRIGGER trg_time_off_requests_updated_at
  BEFORE UPDATE ON time_off_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- RLS — service-role writes from Next API routes (which enforce the
-- role/office scoping in application code). We leave RLS enabled but
-- with no permissive policies for authenticated users; the launcher
-- always uses the service-role key.
-- =====================================================================
ALTER TABLE time_punches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests  ENABLE ROW LEVEL SECURITY;
