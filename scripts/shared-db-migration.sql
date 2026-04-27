-- BBD Launcher migration for the SHARED Supabase project (also hosts ASC + QSB).
-- Skips anything that touches the existing `profiles` table — ASC owns that schema.
-- Adds: launcher_* tables, launcher_sections, get_user_role() helper, JWT enum,
-- RLS policies, default link seeds.

-- ---------------------------------------------------------------------------
-- 001 — launcher_roles (without altering profiles)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS launcher_roles (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO launcher_roles (name, display_name, description, is_admin) VALUES
  ('admin', 'Administrator', 'Full system access', TRUE),
  ('manager', 'Manager', 'Team management and reporting access', FALSE),
  ('sales_rep', 'Sales Representative', 'Sales tools and CRM access', FALSE),
  ('bst', 'BST', 'Building Success Team', FALSE),
  ('rnd', 'R&D', 'Research and Development tools', FALSE)
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 002 — launcher_apps + role-app access
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE sso_type AS ENUM ('none', 'saml', 'oauth', 'direct_link');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE app_status AS ENUM ('active', 'inactive', 'maintenance');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

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

CREATE TABLE IF NOT EXISTS launcher_role_app_access (
  role_name TEXT NOT NULL REFERENCES launcher_roles(name) ON DELETE CASCADE,
  app_id UUID NOT NULL REFERENCES launcher_apps(id) ON DELETE CASCADE,
  PRIMARY KEY (role_name, app_id)
);

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

-- ---------------------------------------------------------------------------
-- 003 — SSO configs + audit log
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 004 — RLS policies + get_user_role helper
-- ---------------------------------------------------------------------------
ALTER TABLE launcher_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_role_app_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_sso_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_sso_audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

DROP POLICY IF EXISTS "Apps readable by authenticated users" ON launcher_apps;
CREATE POLICY "Apps readable by authenticated users"
  ON launcher_apps FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Apps writable by admins" ON launcher_apps;
CREATE POLICY "Apps writable by admins"
  ON launcher_apps FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS "Roles readable by authenticated users" ON launcher_roles;
CREATE POLICY "Roles readable by authenticated users"
  ON launcher_roles FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Role access readable by authenticated users" ON launcher_role_app_access;
CREATE POLICY "Role access readable by authenticated users"
  ON launcher_role_app_access FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Role access writable by admins" ON launcher_role_app_access;
CREATE POLICY "Role access writable by admins"
  ON launcher_role_app_access FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS "SSO configs admin only" ON launcher_sso_configs;
CREATE POLICY "SSO configs admin only"
  ON launcher_sso_configs FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS "Audit log readable by admins" ON launcher_sso_audit_log;
CREATE POLICY "Audit log readable by admins"
  ON launcher_sso_audit_log FOR SELECT
  TO authenticated
  USING (get_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 005 — JWT SSO support
-- ---------------------------------------------------------------------------
ALTER TYPE sso_type ADD VALUE IF NOT EXISTS 'jwt';

ALTER TABLE launcher_sso_configs
  ADD COLUMN IF NOT EXISTS jwt_acs_url TEXT,
  ADD COLUMN IF NOT EXISTS jwt_audience TEXT;

-- ---------------------------------------------------------------------------
-- 006 — important links
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS launcher_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  icon_url TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS launcher_links_updated_at ON launcher_links;
CREATE TRIGGER launcher_links_updated_at
  BEFORE UPDATE ON launcher_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE launcher_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Links readable by authenticated users" ON launcher_links;
CREATE POLICY "Links readable by authenticated users"
  ON launcher_links FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Links writable by admins" ON launcher_links;
CREATE POLICY "Links writable by admins"
  ON launcher_links FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- Seed default links only if table is empty.
INSERT INTO launcher_links (name, description, url, icon_url, display_order)
SELECT * FROM (VALUES
  ('Adobe Acrobat Reader', 'Free PDF viewer download', 'https://get.adobe.com/reader/', 'https://www.adobe.com/favicon.ico', 1),
  ('Malwarebytes', 'Anti-malware protection download', 'https://www.malwarebytes.com/mwb-download', 'https://www.malwarebytes.com/favicon-32x32.png', 2),
  ('Slack', 'Team messaging app download', 'https://slack.com/downloads', 'https://a.slack-edge.com/80588/marketing/img/meta/favicon-32.png', 3),
  ('Google Chrome', 'Web browser download', 'https://www.google.com/chrome/', 'https://www.google.com/chrome/static/images/favicons/favicon-32x32.png', 4),
  ('Google Meet', 'Video conferencing & calls', 'https://meet.google.com/', 'https://fonts.gstatic.com/s/i/productlogos/meet_2020q4/v1/web-32dp/logo_meet_2020q4_color_1x_web_32dp.png', 5),
  ('ADP', 'Payroll, HR & time tracking', 'https://online.adp.com/', 'https://www.adp.com/favicon.ico', 6)
) AS v(name, description, url, icon_url, display_order)
WHERE NOT EXISTS (SELECT 1 FROM launcher_links);

-- ---------------------------------------------------------------------------
-- 007 — sections
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS launcher_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE launcher_apps
  ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES launcher_sections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS launcher_apps_section_id_idx ON launcher_apps(section_id);

DROP TRIGGER IF EXISTS launcher_sections_updated_at ON launcher_sections;
CREATE TRIGGER launcher_sections_updated_at
  BEFORE UPDATE ON launcher_sections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE launcher_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Sections readable by authenticated users" ON launcher_sections;
CREATE POLICY "Sections readable by authenticated users"
  ON launcher_sections FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Sections writable by admins" ON launcher_sections;
CREATE POLICY "Sections writable by admins"
  ON launcher_sections FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');
