-- Migration 37: employee offboarding.
--
-- When someone leaves, an admin / IT user opens an offboarding case. The
-- case snapshots the active checklist template into per-case tasks (plus
-- one "revoke access" task per launcher app the person could open), and
-- each task records who did it, when, and any note (e.g. where the Gmail
-- backup was stored). Every action also lands in offboarding_events, an
-- append-only audit trail.
--
--   offboarding_checklist_items  editable template (/offboarding/checklist)
--   offboarding_cases            one per departing employee
--   offboarding_tasks            the case's checklist, snapshotted at open
--   offboarding_events           append-only who/what/when log

-- =====================================================================
-- offboarding_checklist_items — the template
-- =====================================================================
CREATE TABLE IF NOT EXISTS offboarding_checklist_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title              TEXT NOT NULL,
  -- Where the work happens ("Google Workspace", "Slack", "Payroll").
  system             TEXT NOT NULL,
  category           TEXT NOT NULL
                       CHECK (category IN ('access', 'data', 'hardware', 'hr')),
  instructions       TEXT,
  -- Forces a note on completion — used for backups so the case records
  -- WHERE the data went, not just that someone ticked the box.
  requires_note      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Optional default owner; copied onto each new case's task.
  default_assignee   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  display_order      INT NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE offboarding_checklist_items ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- offboarding_cases
-- =====================================================================
CREATE TABLE IF NOT EXISTS offboarding_cases (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL so the case (and its audit trail) outlives a hard-deleted
  -- profile; the employee_* columns keep who it was about.
  profile_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  employee_name      TEXT,
  employee_email     TEXT NOT NULL,
  employee_role      TEXT,
  employee_office    TEXT,
  employee_department TEXT,

  last_day           DATE NOT NULL,
  reason             TEXT NOT NULL
                       CHECK (reason IN ('resigned', 'terminated', 'laid_off', 'contract_end', 'other')),
  notes              TEXT,

  status             TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'completed', 'cancelled')),
  opened_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  closed_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  closed_at          TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One open case per person at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_offboarding_cases_one_open
  ON offboarding_cases (profile_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_offboarding_cases_status
  ON offboarding_cases (status, last_day);

ALTER TABLE offboarding_cases ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- offboarding_tasks — snapshot of the template at case open
-- =====================================================================
CREATE TABLE IF NOT EXISTS offboarding_tasks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id            UUID NOT NULL REFERENCES offboarding_cases(id) ON DELETE CASCADE,
  -- Source template row (null for generated per-app tasks, or if the
  -- template item was later deleted). Title etc. are copied so editing
  -- the template never rewrites history.
  item_id            UUID REFERENCES offboarding_checklist_items(id) ON DELETE SET NULL,
  app_id             UUID,
  title              TEXT NOT NULL,
  system             TEXT NOT NULL,
  category           TEXT NOT NULL
                       CHECK (category IN ('access', 'data', 'hardware', 'hr')),
  instructions       TEXT,
  requires_note      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Built-in one-click actions the launcher can perform itself
  -- (see src/lib/offboarding/actions.ts). Null = manual task.
  auto_action        TEXT CHECK (auto_action IN ('deactivate_launcher', 'export_launcher_data')),
  display_order      INT NOT NULL DEFAULT 0,

  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'done', 'not_applicable')),
  assigned_to        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  completed_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at       TIMESTAMPTZ,
  note               TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offboarding_tasks_case
  ON offboarding_tasks (case_id, display_order);
CREATE INDEX IF NOT EXISTS idx_offboarding_tasks_assignee
  ON offboarding_tasks (assigned_to) WHERE status = 'pending';

ALTER TABLE offboarding_tasks ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- offboarding_events — append-only audit trail
-- =====================================================================
CREATE TABLE IF NOT EXISTS offboarding_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id            UUID NOT NULL REFERENCES offboarding_cases(id) ON DELETE CASCADE,
  task_id            UUID REFERENCES offboarding_tasks(id) ON DELETE SET NULL,
  event_type         TEXT NOT NULL,
  actor_profile_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- Snapshot of the actor's name so the log reads correctly even after
  -- the actor's own profile is gone.
  actor_name         TEXT,
  actor_ip           TEXT,
  actor_ua           TEXT,
  details            JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offboarding_events_case
  ON offboarding_events (case_id, created_at);

ALTER TABLE offboarding_events ENABLE ROW LEVEL SECURITY;

-- updated_at bookkeeping (set_updated_at() is defined in 019).
DROP TRIGGER IF EXISTS trg_offboarding_items_updated_at ON offboarding_checklist_items;
CREATE TRIGGER trg_offboarding_items_updated_at
  BEFORE UPDATE ON offboarding_checklist_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_offboarding_cases_updated_at ON offboarding_cases;
CREATE TRIGGER trg_offboarding_cases_updated_at
  BEFORE UPDATE ON offboarding_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_offboarding_tasks_updated_at ON offboarding_tasks;
CREATE TRIGGER trg_offboarding_tasks_updated_at
  BEFORE UPDATE ON offboarding_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Private bucket for launcher-data backups taken during offboarding.
-- Served only through /api/offboarding/cases/[id]/exports/[file], which
-- re-checks offboarding permission and mints a short-lived signed URL.
INSERT INTO storage.buckets (id, name, public)
VALUES ('offboarding-exports', 'offboarding-exports', false)
ON CONFLICT (id) DO NOTHING;

-- =====================================================================
-- Seed template. Edit freely at /offboarding/checklist — cases snapshot
-- the template when opened, so changes only affect future cases.
-- =====================================================================
INSERT INTO offboarding_checklist_items (title, system, category, instructions, requires_note, display_order)
SELECT * FROM (VALUES
  -- Access
  ('Reset password and sign out of all sessions', 'Google Workspace', 'access',
   'Admin console → Users → the employee → Reset password, then Security → Sign-in cookies → Reset. Do this first, before anything else.', FALSE, 10),
  ('Revoke app passwords, OAuth tokens and 2-step backup codes', 'Google Workspace', 'access',
   'Admin console → Users → Security: revoke app passwords, connected third-party apps, and backup verification codes.', FALSE, 20),
  ('Remove from Google Groups and shared drives', 'Google Workspace', 'access',
   'Remove from distribution lists (sales@, support@, …) and shared drives so they stop receiving company mail.', FALSE, 30),
  ('Deactivate Slack account', 'Slack', 'access',
   'Workspace settings → Manage members → Deactivate account.', FALSE, 40),
  ('Revoke authenticator devices', 'BBD Authenticator', 'access',
   'Remove any enrolled TOTP devices for the employee.', FALSE, 50),
  ('Rotate shared passwords they knew', 'Shared credentials', 'access',
   'Any shared logins (vendor / manufacturer portals, shared inboxes, Wi-Fi, door codes). List what was rotated in the note.', TRUE, 60),
  ('Remove phone extension / forward line', 'Phone system', 'access',
   'Forward their extension or direct number to their manager, then remove the user.', FALSE, 70),
  ('Remove from developer tools', 'GitHub / Vercel / Supabase', 'access',
   'Dev staff only — mark N/A otherwise. Remove from the GitHub org, Vercel team and Supabase project; rotate any keys they had.', FALSE, 80),

  -- Data
  ('Export Gmail and upload to BBD Mbox Archive', 'Gmail', 'data',
   'Google Takeout (or Admin console Data Export) → mbox, then ingest into BBD Mbox Archive. Record the archive location in the note.', TRUE, 110),
  ('Transfer Google Drive ownership', 'Google Drive', 'data',
   'Admin console → Apps → Google Workspace → Drive → Transfer ownership to their manager. Record who received it.', TRUE, 120),
  ('Set up email forwarding / auto-reply', 'Gmail', 'data',
   'Delegate the inbox or forward to the manager and set an auto-reply pointing customers to the new contact.', FALSE, 130),
  ('Transfer calendar events they own', 'Google Calendar', 'data',
   'Transfer or cancel recurring meetings they organize.', FALSE, 140),
  ('Reassign open orders, quotes and tickets', 'Sales / BST tools', 'data',
   'Reassign their open deals, orders, customer tickets and follow-ups to another rep. Note who took them over.', TRUE, 150),

  -- Hardware
  ('Collect laptop and equipment', 'Hardware', 'hardware',
   'Collect laptop, monitors, headset, chargers. Note asset tags.', TRUE, 210),
  ('Wipe and reissue laptop', 'Hardware', 'hardware',
   'Only AFTER the Gmail / Drive backups above are confirmed.', FALSE, 220),
  ('Collect keys, badge and access cards', 'Facilities', 'hardware',
   'Change door codes if they had one.', FALSE, 230),
  ('Cancel company phone / credit card', 'Finance', 'hardware',
   'Mark N/A if they had neither.', FALSE, 240),

  -- HR / admin
  ('Process final paycheck and PTO payout', 'Payroll', 'hr', NULL, FALSE, 310),
  ('Remove from payroll and commission plan', 'Payroll', 'hr', NULL, FALSE, 320),
  ('Send benefits / COBRA notice', 'Benefits', 'hr', NULL, FALSE, 330),
  ('Exit interview and property-return acknowledgement', 'HR', 'hr', NULL, FALSE, 340)
) AS seed(title, system, category, instructions, requires_note, display_order)
WHERE NOT EXISTS (SELECT 1 FROM offboarding_checklist_items);
