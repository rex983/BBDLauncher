-- Migration 48: drop schema nothing reads any more.
--
--   ai_config                        singleton AI provider/model selector
--                                    (migration 27); the /admin/ai page and
--                                    src/lib/ai reader are gone.
--   incident_reports.ai_provider, ai_model, ai_prompt, ai_generated_document
--                                    AI drafting audit columns (migration 26);
--                                    incident reports are no longer AI-drafted
--                                    and no code reads or writes them.
--   launcher_apps_offices_backup_034 one-off backup of launcher_apps.offices
--                                    taken by migration 34.
--
-- Verified before writing: no reference to any of these in src/ or scripts/.
-- launcher_apps.offices itself is NOT dropped — the dashboard and launch
-- gate still read it as a legacy second office gate.
--
-- Irreversible: take a backup first if any of this data matters.

BEGIN;

DROP TABLE IF EXISTS ai_config;

ALTER TABLE IF EXISTS incident_reports
  DROP COLUMN IF EXISTS ai_provider,
  DROP COLUMN IF EXISTS ai_model,
  DROP COLUMN IF EXISTS ai_prompt,
  DROP COLUMN IF EXISTS ai_generated_document;

DROP TABLE IF EXISTS launcher_apps_offices_backup_034;

COMMIT;
