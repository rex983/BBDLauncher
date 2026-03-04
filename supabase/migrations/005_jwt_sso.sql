-- Migration 5: JWT SSO support

-- Add 'jwt' to sso_type enum
ALTER TYPE sso_type ADD VALUE IF NOT EXISTS 'jwt';

-- Add JWT-specific columns to SSO configs
ALTER TABLE launcher_sso_configs
  ADD COLUMN IF NOT EXISTS jwt_acs_url TEXT,
  ADD COLUMN IF NOT EXISTS jwt_audience TEXT;
