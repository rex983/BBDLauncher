-- Migration 4: RLS Policies

-- Enable RLS on all launcher tables
ALTER TABLE launcher_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_role_app_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_sso_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_sso_audit_log ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- launcher_apps: readable by all authenticated users, writable by admins
CREATE POLICY "Apps readable by authenticated users"
  ON launcher_apps FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Apps writable by admins"
  ON launcher_apps FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- launcher_roles: readable by all authenticated users
CREATE POLICY "Roles readable by authenticated users"
  ON launcher_roles FOR SELECT
  TO authenticated
  USING (TRUE);

-- launcher_role_app_access: readable by all, writable by admins
CREATE POLICY "Role access readable by authenticated users"
  ON launcher_role_app_access FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Role access writable by admins"
  ON launcher_role_app_access FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- launcher_sso_configs: admin-only
CREATE POLICY "SSO configs admin only"
  ON launcher_sso_configs FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- launcher_sso_audit_log: admin-readable, system-insertable via service role
CREATE POLICY "Audit log readable by admins"
  ON launcher_sso_audit_log FOR SELECT
  TO authenticated
  USING (get_user_role() = 'admin');

-- Allow service role to insert audit logs (no RLS restriction for service role by default)
-- Service role bypasses RLS, so no explicit insert policy needed for it
