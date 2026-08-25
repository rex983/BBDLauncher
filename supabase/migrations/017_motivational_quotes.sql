-- Migration 17: Motivational Quotes.
--
-- A single-active-at-a-time table of professional motivational quotes shown
-- on the launcher dashboard. Auto-refreshed weekly by a Vercel cron; can
-- also be manually refreshed / edited by admins.
--
-- Uniformity: exactly one row has is_active = TRUE at a time (enforced by a
-- partial unique index). Every employee sees the same active quote.

CREATE TABLE IF NOT EXISTS launcher_motivational_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote TEXT NOT NULL,
  author TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'ai_cron', 'ai_manual', 'seed')),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

-- Enforce at most one active quote at a time.
CREATE UNIQUE INDEX IF NOT EXISTS launcher_motivational_quotes_one_active
  ON launcher_motivational_quotes (is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS launcher_motivational_quotes_created_at_idx
  ON launcher_motivational_quotes (created_at DESC);

-- RLS: launcher uses the service-role admin client for all writes and
-- reads from this table, so we only need a permissive SELECT policy for
-- anon/authenticated in case anyone ever queries with the anon key.
ALTER TABLE launcher_motivational_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS launcher_motivational_quotes_select ON launcher_motivational_quotes;
CREATE POLICY launcher_motivational_quotes_select
  ON launcher_motivational_quotes
  FOR SELECT
  USING (TRUE);

-- Seed 10 professional, non-controversial quotes so the banner has content
-- on day one before the first cron / AI fetch. is_active TRUE on the first
-- one; the rest are inactive history.
INSERT INTO launcher_motivational_quotes (quote, author, source, is_active, activated_at)
VALUES
  ('The way to get started is to quit talking and begin doing.', 'Walt Disney', 'seed', TRUE, NOW()),
  ('Success is not final, failure is not fatal: it is the courage to continue that counts.', 'Winston Churchill', 'seed', FALSE, NULL),
  ('Don''t watch the clock; do what it does. Keep going.', 'Sam Levenson', 'seed', FALSE, NULL),
  ('The only place where success comes before work is in the dictionary.', 'Vidal Sassoon', 'seed', FALSE, NULL),
  ('Opportunities don''t happen. You create them.', 'Chris Grosser', 'seed', FALSE, NULL),
  ('Quality is not an act, it is a habit.', 'Aristotle', 'seed', FALSE, NULL),
  ('The best way to predict the future is to create it.', 'Peter Drucker', 'seed', FALSE, NULL),
  ('It always seems impossible until it''s done.', 'Nelson Mandela', 'seed', FALSE, NULL),
  ('Whether you think you can, or you think you can''t — you''re right.', 'Henry Ford', 'seed', FALSE, NULL),
  ('The harder you work for something, the greater you''ll feel when you achieve it.', 'Anonymous', 'seed', FALSE, NULL)
ON CONFLICT DO NOTHING;
