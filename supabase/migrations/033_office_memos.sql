-- Migration 33: office-wide memo delivery system.
--
-- Managers + admins publish memos (policy changes, announcements, safety
-- notices, etc.) to a scoped audience (company / office / department /
-- custom list). Each memo fans out to a `office_memo_recipients` row per
-- employee, so the manager can see who was reached and who has read/
-- acknowledged, and the employee sees only memos where they're a recipient.
--
-- Three acknowledgement modes:
--   informational  — bell notification only, no receipt required
--   read_receipt   — recipient's read_at gets set when they open it
--   signed         — recipient must type their name (SHA-256 hash chain
--                    identical to incident_reports; author signs the doc
--                    at publish time, recipient countersigns to ack)
--
-- Edit-without-void: editing a published memo tracks edit_count +
-- last_editor + audit event, but does NOT clear recipients' acks. The
-- author signature stays valid against the original document_hash (which
-- doesn't change on edit) — a subsequent audit event captures the delta.

-- =====================================================================
-- office_memos
-- =====================================================================
CREATE TABLE IF NOT EXISTS office_memos (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Author profile FK. SET NULL so a memo survives its author leaving
  -- the org — the row still shows the historical author name from the
  -- audit trail.
  author_profile_id           UUID REFERENCES profiles(id) ON DELETE SET NULL,

  title                       TEXT NOT NULL,
  body                        TEXT NOT NULL,

  category                    TEXT NOT NULL DEFAULT 'announcement'
                                CHECK (category IN (
                                  'policy',
                                  'procedure',
                                  'safety',
                                  'benefits',
                                  'announcement',
                                  'other'
                                )),
  priority                    TEXT NOT NULL DEFAULT 'informational'
                                CHECK (priority IN (
                                  'informational',
                                  'important',
                                  'mandatory'
                                )),

  -- Acknowledgement mode. informational = no ack needed; read_receipt =
  -- opening the memo stamps read_at on the recipient row; signed = the
  -- employee types their name (hash chained on author + document).
  acknowledgement_mode        TEXT NOT NULL DEFAULT 'read_receipt'
                                CHECK (acknowledgement_mode IN (
                                  'informational',
                                  'read_receipt',
                                  'signed'
                                )),

  -- Audience targeting. `custom` means the recipient list comes from
  -- office_memo_recipients rows that the author explicitly picked;
  -- everything else is derived from a live profiles query at publish
  -- time (snapshot into recipients).
  audience_scope              TEXT NOT NULL
                                CHECK (audience_scope IN (
                                  'company',
                                  'office',
                                  'department',
                                  'custom'
                                )),
  audience_office             TEXT,
  audience_department         TEXT,

  -- When the memo becomes effective (informational only — displayed to
  -- employees so they know when the policy takes effect). Not tied to
  -- publication.
  effective_date              DATE,

  -- Publication timestamp. Set when a manager explicitly publishes; null
  -- while the memo is a draft. Memos never publish on their own — no
  -- schedules, no timers. The manager is the only trigger.
  published_at                TIMESTAMPTZ,

  status                      TEXT NOT NULL DEFAULT 'draft'
                                CHECK (status IN (
                                  'draft',
                                  'published',
                                  'archived'
                                )),

  attachments                 JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- SHA-256 evidence chain (signed-ack memos only). Author signs at
  -- publish time so the document is locked before it fans out.
  document_hash               TEXT,
  author_signature_text       TEXT,
  author_signature_hash       TEXT,
  author_signed_at            TIMESTAMPTZ,
  author_signature_ip         TEXT,
  author_signature_ua         TEXT,

  -- Edit-without-void tracking. edit_count starts at 0; every PATCH
  -- against a published memo increments it. last_editor is a soft FK
  -- (nullable when the last edit was made by the original author or the
  -- editor's account was later deleted).
  edit_count                  INT NOT NULL DEFAULT 0,
  last_editor_profile_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  last_edited_at              TIMESTAMPTZ,

  archived_at                 TIMESTAMPTZ,
  archived_by                 UUID REFERENCES profiles(id) ON DELETE SET NULL,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_office_memos_author
  ON office_memos (author_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_office_memos_status
  ON office_memos (status, created_at DESC);

DROP TRIGGER IF EXISTS trg_office_memos_updated_at ON office_memos;
CREATE TRIGGER trg_office_memos_updated_at
  BEFORE UPDATE ON office_memos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- Sequential human-readable ID (M-0001, M-0002 ...). Mirrors the pattern
-- from migration 030 for incident_reports.
-- =====================================================================
CREATE SEQUENCE IF NOT EXISTS office_memos_number_seq START 1;

ALTER TABLE office_memos
  ADD COLUMN IF NOT EXISTS number INT;

WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS n
  FROM office_memos
  WHERE number IS NULL
)
UPDATE office_memos m
SET number = ordered.n
FROM ordered
WHERE m.id = ordered.id;

SELECT setval(
  'office_memos_number_seq',
  COALESCE((SELECT MAX(number) FROM office_memos), 0) + 1,
  false
);

ALTER TABLE office_memos
  ALTER COLUMN number SET DEFAULT nextval('office_memos_number_seq'),
  ALTER COLUMN number SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'office_memos_number_key'
  ) THEN
    ALTER TABLE office_memos
      ADD CONSTRAINT office_memos_number_key UNIQUE (number);
  END IF;
END $$;

-- =====================================================================
-- office_memo_recipients — fan-out row per employee who was a recipient
-- at publish time. Snapshot semantics: the recipient list is frozen when
-- the memo publishes, so a new hire joining after publication doesn't
-- retroactively become a recipient (that would be confusing — they'd get
-- pinged about a memo issued before their start date).
--
-- If a currently-effective memo needs to catch a new hire, that's an
-- explicit backfill operation (out of scope for MVP).
-- =====================================================================
CREATE TABLE IF NOT EXISTS office_memo_recipients (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  memo_id                UUID NOT NULL REFERENCES office_memos(id) ON DELETE CASCADE,
  profile_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Fan-out timestamp — when the row was created (publication moment,
  -- basically). Kept explicit rather than reusing created_at so a future
  -- "resend to X" flow can create a new recipient row without confusing
  -- fan-out audit.
  delivered_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Set when the recipient opens the memo (read_receipt / signed modes)
  -- or acknowledges (informational memos leave this null forever).
  read_at                TIMESTAMPTZ,

  -- Signed-mode ack captures the same evidentiary bundle as incident
  -- reports: typed name, hash chained on doc + author sig, IP, UA.
  acknowledged_at        TIMESTAMPTZ,
  signature_text         TEXT,
  signature_hash         TEXT,
  signature_ip           TEXT,
  signature_ua           TEXT,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One memo per recipient — attempts to re-fan-out are a no-op instead
  -- of a duplicate row.
  UNIQUE (memo_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_office_memo_recipients_memo
  ON office_memo_recipients (memo_id, delivered_at DESC);

-- Per-employee list: WHERE profile_id = ? ORDER BY delivered_at DESC.
CREATE INDEX IF NOT EXISTS idx_office_memo_recipients_profile
  ON office_memo_recipients (profile_id, delivered_at DESC);

-- Fast "unacknowledged for this employee" query for the profile page badge.
CREATE INDEX IF NOT EXISTS idx_office_memo_recipients_pending
  ON office_memo_recipients (profile_id)
  WHERE acknowledged_at IS NULL;

-- =====================================================================
-- office_memo_events — append-only audit log. Same shape as
-- incident_report_events. Events: draft_saved, published, edited,
-- archived, recipient_read, recipient_acknowledged.
-- =====================================================================
CREATE TABLE IF NOT EXISTS office_memo_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  memo_id              UUID NOT NULL REFERENCES office_memos(id) ON DELETE CASCADE,

  event_type           TEXT NOT NULL,

  actor_profile_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_ip             TEXT,
  actor_ua             TEXT,

  details              JSONB,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_office_memo_events_memo
  ON office_memo_events (memo_id, created_at);

-- =====================================================================
-- Storage bucket for memo attachments (private, signed-URL served).
-- =====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('office-memo-attachments', 'office-memo-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- RLS enabled — all reads/writes go through service-role from API routes.
-- =====================================================================
ALTER TABLE office_memos ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_memo_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_memo_events ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- Realtime publication for the recipient list, so the manager dashboard
-- can watch read/ack activity live and the employee bell can react.
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'office_memos'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE office_memos;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'office_memo_recipients'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE office_memo_recipients;
    END IF;
  END IF;
END $$;
