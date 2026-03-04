-- Migration 2: Apps

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
