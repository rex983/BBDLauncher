-- Migration 26: HR incident reports with AI-assisted drafting and internal e-sign.
--
-- Managers file incident reports about employees in their scope. The launcher
-- asks an LLM to draft the write-up from a free-form description, the manager
-- reviews/edits it, and it moves through a two-signature flow:
--
--   draft -> awaiting_manager_sig -> awaiting_employee_sig -> completed
--
-- Employees can only see reports about themselves, and only after the manager
-- has signed (i.e. from awaiting_employee_sig onward). Signature payloads are
-- inlined on the row — same pattern as time_off_requests.decided_by/at, extended
-- with the actual typed-name signature text + IP + user agent for evidentiary
-- purposes.

-- =====================================================================
-- incident_reports
-- =====================================================================
CREATE TABLE IF NOT EXISTS incident_reports (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who this report is about, and who filed it. Both are profile FKs.
  -- ON DELETE SET NULL on reporter so archived reports outlive the manager's
  -- account; ON DELETE CASCADE on the subject so purging an employee purges
  -- their disciplinary file too (matches time_off_requests behavior).
  employee_profile_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reporter_profile_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- The metadata the manager fills in before the AI drafts anything.
  title                       TEXT NOT NULL,
  severity                    TEXT NOT NULL DEFAULT 'low'
                                CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  category                    TEXT NOT NULL
                                CHECK (category IN (
                                  'attendance',
                                  'performance',
                                  'conduct',
                                  'safety',
                                  'policy',
                                  'other'
                                )),
  occurred_at                 TIMESTAMPTZ,

  -- Free-form input the manager gave the AI. Kept for audit — if we ever
  -- have to defend how a report was generated, this is the raw source.
  description                 TEXT NOT NULL,

  -- Full audit trail of the AI call. `ai_generated_document` is the initial
  -- draft; `document` is the manager's final edited version that gets signed.
  ai_provider                 TEXT,
  ai_model                    TEXT,
  ai_prompt                   TEXT,
  ai_generated_document       TEXT,
  document                    TEXT NOT NULL,
  acknowledgement_text        TEXT NOT NULL,

  status                      TEXT NOT NULL DEFAULT 'draft'
                                CHECK (status IN (
                                  'draft',
                                  'awaiting_manager_sig',
                                  'awaiting_employee_sig',
                                  'completed',
                                  'cancelled'
                                )),

  attachments                 JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Inline signature blocks — same shape as time_off_requests.decided_by/at
  -- but with the full typed-name text and networking context so we can prove
  -- who signed when. IP + user agent are captured at signing time only.
  manager_signed_at           TIMESTAMPTZ,
  manager_signature_text      TEXT,
  manager_signature_ip        TEXT,
  manager_signature_ua        TEXT,

  employee_signed_at          TIMESTAMPTZ,
  employee_signature_text     TEXT,
  employee_signature_ip       TEXT,
  employee_signature_ua       TEXT,

  cancelled_at                TIMESTAMPTZ,
  cancelled_by                UUID REFERENCES profiles(id) ON DELETE SET NULL,
  cancelled_reason            TEXT,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_reports_employee
  ON incident_reports (employee_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_reports_reporter
  ON incident_reports (reporter_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_reports_status
  ON incident_reports (status, created_at DESC);

-- Reuse the shared updated_at trigger function from migration 019.
DROP TRIGGER IF EXISTS trg_incident_reports_updated_at ON incident_reports;
CREATE TRIGGER trg_incident_reports_updated_at
  BEFORE UPDATE ON incident_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- Storage bucket for attachments. Private — served through /api/incidents/
-- attachments/[...path] which mints short-lived signed URLs. Mirror of the
-- time-off-attachments bucket policy.
-- =====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('incident-attachments', 'incident-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- RLS enabled with no permissive policies — all reads/writes go through the
-- service-role key from Next.js API routes, which enforce scope + signing
-- rules in application code. Employees can only see their own reports via
-- /api/incidents; managers see scoped reports via /api/management/incidents.
-- =====================================================================
ALTER TABLE incident_reports ENABLE ROW LEVEL SECURITY;
