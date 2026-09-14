-- Migration 21: Active/inactive flag on profiles.
--
-- Adds is_active (default TRUE) so ex-employees can be marked inactive
-- without deleting the row. Downstream apps in the shared DB inherit
-- the column automatically; each app is responsible for filtering
-- non-admin lists to is_active = true.
--
-- The launcher enforces:
--   * signIn: inactive users cannot start a new session.
--   * jwt callback: existing tokens for inactive users are invalidated
--     on the next request (via session_version bump).
--   * /api/launch/[appId]: inactive users can't mint SSO tokens.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Partial index — most rows are active, so the index is only useful for
-- surfacing the (small) inactive set in admin queries.
CREATE INDEX IF NOT EXISTS idx_profiles_inactive
  ON profiles (id) WHERE is_active = FALSE;
