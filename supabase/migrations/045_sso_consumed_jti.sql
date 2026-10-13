-- Migration 45: SSO replay protection.
--
-- Child apps that consume launcher SSO JWTs record each token's jti here
-- once (service-role insert). A second insert of the same jti fails with a
-- unique violation (23505) and the consumer rejects the token as replayed.
-- Consumers tolerate this table being absent (42P01 / PGRST205), so it can
-- be applied before or after they deploy — apply it first.
--
-- Rows are only needed until the token would have expired anyway; the
-- nightly /api/cron/midnight-signout purges rows past expires_at.
--
-- Service-role only (RLS on, no policies).

BEGIN;

CREATE TABLE IF NOT EXISTS sso_consumed_jti (
  jti          TEXT PRIMARY KEY,
  audience     TEXT NOT NULL,
  consumed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sso_consumed_jti_expires_at_idx
  ON sso_consumed_jti (expires_at);

ALTER TABLE sso_consumed_jti ENABLE ROW LEVEL SECURITY;

COMMIT;
