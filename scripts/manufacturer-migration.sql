-- Migrate manufacturer_config + changelog from defunct Order Process DB
-- (mauappkwxiebfccayhcw) into the shared BBD Dashboard DB (xockuiyvxijuzlwlsfbu).
-- Uses launcher's get_user_role() helper for RLS — assumes shared-db-migration.sql
-- has already been applied.

CREATE TABLE IF NOT EXISTS manufacturer_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT,
  sign_now_template_id TEXT NOT NULL DEFAULT '',
  deposit_percent NUMERIC(5,2),
  deposit_tiers JSONB,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_config_name ON manufacturer_config(name);
CREATE INDEX IF NOT EXISTS idx_manufacturer_config_active ON manufacturer_config(active);

ALTER TABLE manufacturer_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manufacturers readable by authenticated users" ON manufacturer_config;
CREATE POLICY "Manufacturers readable by authenticated users"
  ON manufacturer_config FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Manufacturers writable by admins" ON manufacturer_config;
CREATE POLICY "Manufacturers writable by admins"
  ON manufacturer_config FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE TABLE IF NOT EXISTS manufacturer_config_changelog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id TEXT NOT NULL,
  config_name TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  changes JSONB NOT NULL DEFAULT '[]',
  user_id TEXT NOT NULL,
  user_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manufacturer_config_changelog_config_id ON manufacturer_config_changelog(config_id);
CREATE INDEX IF NOT EXISTS idx_manufacturer_config_changelog_created_at ON manufacturer_config_changelog(created_at DESC);

ALTER TABLE manufacturer_config_changelog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Changelog readable by admins" ON manufacturer_config_changelog;
CREATE POLICY "Changelog readable by admins"
  ON manufacturer_config_changelog FOR SELECT
  TO authenticated
  USING (get_user_role() = 'admin');

DROP POLICY IF EXISTS "Changelog insertable by authenticated" ON manufacturer_config_changelog;
CREATE POLICY "Changelog insertable by authenticated"
  ON manufacturer_config_changelog FOR INSERT
  TO authenticated
  WITH CHECK (true);
