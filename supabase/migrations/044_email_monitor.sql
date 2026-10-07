-- Migration 44: the retired-mail monitor becomes the Email monitor and
-- watches more than one mailbox (retiredemployees@ and orders@).
--
-- mail_monitor_mailboxes   one row per watched mailbox: its Apps Script
--                          heartbeat (replaces retired_mail_heartbeat) and,
--                          for mailboxes that use it, the people an admin
--                          chose to tag in Slack.
-- retired_mail_log.mailbox which mailbox an email arrived in.
--
-- Service-role only (RLS on, no policies); /admin/email-monitor reads them.

BEGIN;

CREATE TABLE IF NOT EXISTS mail_monitor_mailboxes (
  mailbox          TEXT PRIMARY KEY CHECK (mailbox = lower(mailbox)),
  last_check_at    TIMESTAMPTZ,
  last_error       TEXT,
  last_error_at    TIMESTAMPTZ,
  tag_profile_ids  UUID[] NOT NULL DEFAULT '{}'
);

-- Carry the retiredemployees@ script's heartbeat over.
INSERT INTO mail_monitor_mailboxes (mailbox, last_check_at, last_error, last_error_at)
SELECT 'retiredemployees@bigbuildingsdirect.com', last_check_at, last_error, last_error_at
FROM retired_mail_heartbeat WHERE id = 1
ON CONFLICT (mailbox) DO NOTHING;

INSERT INTO mail_monitor_mailboxes (mailbox) VALUES
  ('retiredemployees@bigbuildingsdirect.com'),
  ('orders@bigbuildingsdirect.com')
ON CONFLICT (mailbox) DO NOTHING;

ALTER TABLE mail_monitor_mailboxes ENABLE ROW LEVEL SECURITY;

ALTER TABLE retired_mail_log
  ADD COLUMN IF NOT EXISTS mailbox TEXT NOT NULL DEFAULT 'retiredemployees@bigbuildingsdirect.com';
CREATE INDEX IF NOT EXISTS retired_mail_log_mailbox_idx ON retired_mail_log (mailbox, received_at DESC);

COMMIT;
