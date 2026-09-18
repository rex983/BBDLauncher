-- Migration 27: single-row config for the active AI provider + model.
--
-- The AI abstraction (src/lib/ai) previously read AI_PROVIDER and AI_MODEL
-- straight from env, which meant swapping providers required a redeploy.
-- Moving the two selectors to the database lets an admin flip between
-- Gemini/Anthropic/OpenAI at /admin/ai in seconds. API KEYS stay in env —
-- only the "which provider is active + which model to ask" lives here.
--
-- Singleton table pattern: id is a smallint pinned to 1 via a CHECK, so
-- there is at most one row. We seed one row up-front so the app never has
-- to handle the "no config yet" case at runtime.

CREATE TABLE IF NOT EXISTS ai_config (
  id           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider     TEXT NOT NULL DEFAULT 'gemini'
                 CHECK (provider IN ('gemini', 'anthropic', 'openai')),
  model        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID REFERENCES profiles(id) ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS trg_ai_config_updated_at ON ai_config;
CREATE TRIGGER trg_ai_config_updated_at
  BEFORE UPDATE ON ai_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO ai_config (id, provider, model)
VALUES (1, 'gemini', NULL)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE ai_config ENABLE ROW LEVEL SECURITY;
