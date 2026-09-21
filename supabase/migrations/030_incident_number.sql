-- Migration 30: sequential human-readable ID for incident reports.
--
-- Product wanted a simple 4-digit number per report (#0001, #0002 ...) that
-- managers can reference in Slack, emails, and printed copies without
-- pasting UUIDs. A Postgres sequence backs the column so concurrent
-- inserts never collide.
--
-- Backfill existing rows in creation order so pre-migration reports get
-- stable numbers matching their history. New rows pick up the sequence
-- default automatically.

CREATE SEQUENCE IF NOT EXISTS incident_reports_number_seq START 1;

ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS number INT;

-- Backfill by created_at (oldest = #1). Uses a CTE so ROW_NUMBER runs
-- once and every UPDATE fires from that snapshot — safe under concurrent
-- inserts because we filter WHERE number IS NULL.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS n
  FROM incident_reports
  WHERE number IS NULL
)
UPDATE incident_reports ir
SET number = ordered.n
FROM ordered
WHERE ir.id = ordered.id;

-- Fast-forward the sequence past whatever we just backfilled so the next
-- insert continues cleanly.
SELECT setval(
  'incident_reports_number_seq',
  COALESCE((SELECT MAX(number) FROM incident_reports), 0) + 1,
  false
);

-- Wire the default now that the column is populated, then lock down the
-- constraints so bad data can't slip in.
ALTER TABLE incident_reports
  ALTER COLUMN number SET DEFAULT nextval('incident_reports_number_seq'),
  ALTER COLUMN number SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'incident_reports_number_key'
  ) THEN
    ALTER TABLE incident_reports
      ADD CONSTRAINT incident_reports_number_key UNIQUE (number);
  END IF;
END $$;
