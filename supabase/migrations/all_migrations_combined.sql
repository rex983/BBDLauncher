-- =============================================================
-- BBD Launcher — All Migrations Combined (001 through 005)
-- Run this in Supabase SQL Editor in one shot
-- =============================================================

-- =====================
-- Migration 1: Roles
-- =====================

-- Update the CHECK constraint on profiles.role to include new roles
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'manager', 'sales_rep', 'bst', 'rnd'));

-- Create launcher_roles table
CREATE TABLE IF NOT EXISTS launcher_roles (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed roles
INSERT INTO launcher_roles (name, display_name, description, is_admin) VALUES
  ('admin', 'Administrator', 'Full system access', TRUE),
  ('manager', 'Manager', 'Team management and reporting access', FALSE),
  ('sales_rep', 'Sales Representative', 'Sales tools and CRM access', FALSE),
  ('bst', 'BST', 'Building Services Technician tools', FALSE),
  ('rnd', 'R&D', 'Research and Development tools', FALSE)
ON CONFLICT (name) DO NOTHING;

-- =====================
-- Migration 2: Apps
-- =====================

-- SSO type enum
DO $$ BEGIN
  CREATE TYPE sso_type AS ENUM ('none', 'saml', 'oauth', 'direct_link');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- App status enum
DO $$ BEGIN
  CREATE TYPE app_status AS ENUM ('active', 'inactive', 'maintenance');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Launcher apps table
CREATE TABLE IF NOT EXISTS launcher_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  icon_url TEXT,
  sso_type sso_type NOT NULL DEFAULT 'none',
  status app_status NOT NULL DEFAULT 'active',
  display_order INTEGER NOT NULL DEFAULT 0,
  open_in_new_tab BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Role-app access join table
CREATE TABLE IF NOT EXISTS launcher_role_app_access (
  role_name TEXT NOT NULL REFERENCES launcher_roles(name) ON DELETE CASCADE,
  app_id UUID NOT NULL REFERENCES launcher_apps(id) ON DELETE CASCADE,
  PRIMARY KEY (role_name, app_id)
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS launcher_apps_updated_at ON launcher_apps;
CREATE TRIGGER launcher_apps_updated_at
  BEFORE UPDATE ON launcher_apps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================
-- Migration 3: SSO Configs and Audit Log
-- =====================

CREATE TABLE IF NOT EXISTS launcher_sso_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES launcher_apps(id) ON DELETE CASCADE UNIQUE,
  sp_entity_id TEXT,
  acs_url TEXT,
  slo_url TEXT,
  sp_cert TEXT,
  name_id_format TEXT NOT NULL DEFAULT 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  attribute_mapping JSONB,
  oauth_client_id TEXT,
  oauth_client_secret TEXT,
  oauth_authorize_url TEXT,
  oauth_token_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS launcher_sso_configs_updated_at ON launcher_sso_configs;
CREATE TRIGGER launcher_sso_configs_updated_at
  BEFORE UPDATE ON launcher_sso_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Audit log
CREATE TABLE IF NOT EXISTS launcher_sso_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  app_id UUID NOT NULL REFERENCES launcher_apps(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  details JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON launcher_sso_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_app_id ON launcher_sso_audit_log(app_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON launcher_sso_audit_log(created_at DESC);

-- =====================
-- Migration 4: RLS Policies
-- =====================

ALTER TABLE launcher_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_role_app_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_sso_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_sso_audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE POLICY "Apps readable by authenticated users"
  ON launcher_apps FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Apps writable by admins"
  ON launcher_apps FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "Roles readable by authenticated users"
  ON launcher_roles FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Role access readable by authenticated users"
  ON launcher_role_app_access FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Role access writable by admins"
  ON launcher_role_app_access FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "SSO configs admin only"
  ON launcher_sso_configs FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "Audit log readable by admins"
  ON launcher_sso_audit_log FOR SELECT
  TO authenticated
  USING (get_user_role() = 'admin');

-- =====================
-- Migration 5: JWT SSO support
-- =====================

ALTER TYPE sso_type ADD VALUE IF NOT EXISTS 'jwt';

ALTER TABLE launcher_sso_configs
  ADD COLUMN IF NOT EXISTS jwt_acs_url TEXT,
  ADD COLUMN IF NOT EXISTS jwt_audience TEXT;
