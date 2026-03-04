-- Migration 3: SSO Configs and Audit Log

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
