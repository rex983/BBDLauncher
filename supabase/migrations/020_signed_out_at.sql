-- Migration 20: Force-signout support for the nightly midnight cron.
--
-- profiles.signed_out_at is a timestamp used by the launcher's NextAuth
-- jwt callback to invalidate all outstanding JWTs at once. When the
-- callback loads the profile and sees that signed_out_at > token.iat,
-- it returns null — the browser session is treated as expired and the
-- user is redirected to /login on their next request.
--
-- Populated by /api/cron/midnight-signout, which also fires a clock_out
-- punch for anyone still on the clock at midnight ET.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS signed_out_at TIMESTAMPTZ;
