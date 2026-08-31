-- Migration 18: Add launcher_motivational_quotes to the Supabase realtime
-- publication so browser clients get pushed INSERT events when the admin
-- refreshes the quote (or the weekly cron fires). Everyone's dashboard
-- updates without a reload.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'launcher_motivational_quotes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE launcher_motivational_quotes;
  END IF;
END $$;
