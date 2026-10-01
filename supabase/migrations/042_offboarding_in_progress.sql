-- Migration 42: an "in progress" status for offboarding tasks that take a
-- while (e.g. a Gmail export). Records who started it and when.

BEGIN;

ALTER TABLE offboarding_tasks DROP CONSTRAINT IF EXISTS offboarding_tasks_status_check;
ALTER TABLE offboarding_tasks ADD CONSTRAINT offboarding_tasks_status_check
  CHECK (status IN ('pending', 'in_progress', 'done', 'not_applicable'));

ALTER TABLE offboarding_tasks
  ADD COLUMN IF NOT EXISTS started_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

COMMIT;
