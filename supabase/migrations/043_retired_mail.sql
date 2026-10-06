-- Migration 43: monitoring for the retiredemployees@ mail → Slack pipeline.
--
-- retired_mail_log        one row per email the Apps Script forwarded, with
--                         the spam verdict and whether Slack was pinged.
--                         message_id is unique so a resend never double-posts.
-- retired_mail_senders    admin overrides: always alert / never alert for an
--                         address or a whole @domain.
-- retired_mail_heartbeat  singleton the script touches every few minutes, so
--                         the launcher notices when it stops running.
--
-- Service-role only (RLS on, no policies); /admin/retired-mail reads them.

BEGIN;

CREATE TABLE IF NOT EXISTS retired_mail_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      TEXT NOT NULL UNIQUE,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  from_text       TEXT NOT NULL DEFAULT '',
  subject         TEXT NOT NULL DEFAULT '',
  preview         TEXT NOT NULL DEFAULT '',
  recipients      TEXT[] NOT NULL DEFAULT '{}',
  sent_to         TEXT,
  employee_name   TEXT,
  case_id         UUID REFERENCES offboarding_cases(id) ON DELETE SET NULL,
  junk            BOOLEAN NOT NULL DEFAULT FALSE,
  reason          TEXT,
  decided_by      TEXT NOT NULL DEFAULT 'rules'
                    CHECK (decided_by IN ('rules', 'ai', 'sender', 'admin')),
  slack_posted    BOOLEAN NOT NULL DEFAULT FALSE,
  slack_error     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS retired_mail_log_received_idx ON retired_mail_log (received_at DESC);

CREATE TABLE IF NOT EXISTS retired_mail_senders (
  pattern     TEXT PRIMARY KEY CHECK (pattern = lower(pattern)),
  action      TEXT NOT NULL CHECK (action IN ('allow', 'block')),
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS retired_mail_heartbeat (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_check_at  TIMESTAMPTZ,
  last_error     TEXT,
  last_error_at  TIMESTAMPTZ
);
INSERT INTO retired_mail_heartbeat (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE retired_mail_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE retired_mail_senders ENABLE ROW LEVEL SECURITY;
ALTER TABLE retired_mail_heartbeat ENABLE ROW LEVEL SECURITY;

COMMIT;
