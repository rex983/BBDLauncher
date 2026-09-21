-- Migration 29: user-facing notifications for the bell in the header.
--
-- Polymorphic — every workflow that needs to ping a user drops a row here
-- via createNotification() with a type, title, optional body, and an
-- optional href to route to. The launcher's bell UI reads them ordered by
-- created_at DESC, with unread ones (read_at IS NULL) sorted first.
--
-- Two soft-delete columns:
--   read_at        — user clicked/opened; still visible but "old"
--   dismissed_at   — user cleared it; hidden from the bell entirely
--
-- We intentionally keep dismissed rows around instead of hard-deleting so
-- the audit trail for evidentiary notifications (like incident-report
-- routing) survives an over-eager click.

CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Recipient. Deleting a profile drops their notification history with them.
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Semantic tag so the bell can render different icons + so we can filter
  -- server-side ("give me all incident_report_awaiting for this user").
  type            TEXT NOT NULL,

  title           TEXT NOT NULL,
  body            TEXT,
  href            TEXT,

  -- Loose polymorphic reference back to the row that spawned the
  -- notification. reference_type is a string label ("incident_report") and
  -- reference_id is the UUID. Not FK'd — a notification survives its
  -- source row being deleted; the user just gets a 404 on click.
  reference_type  TEXT,
  reference_id    UUID,

  -- Free-form extras for anything a specific notification type needs.
  metadata        JSONB,

  read_at         TIMESTAMPTZ,
  dismissed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The bell list query: WHERE user_id = ? AND dismissed_at IS NULL ORDER BY created_at DESC.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC)
  WHERE dismissed_at IS NULL;

-- The unread-count query: WHERE user_id = ? AND dismissed_at IS NULL AND read_at IS NULL.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id)
  WHERE dismissed_at IS NULL AND read_at IS NULL;

-- Dismiss/clear by reference so the sign endpoint can nuke the pending
-- pointer without knowing the notification id: WHERE reference_type = ? AND reference_id = ?.
CREATE INDEX IF NOT EXISTS idx_notifications_reference
  ON notifications (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Wire notifications into Supabase realtime so the bell can subscribe and
-- update without polling. The publication already carries time_off_requests
-- and incident_reports; this just adds one more table to it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'notifications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
    END IF;
  END IF;
END $$;
