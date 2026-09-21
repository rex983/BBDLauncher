-- Migration 28: cryptographic evidence chain on incident_reports signatures.
--
-- Extends the existing typed-name signature capture (text + timestamp + IP +
-- user agent) with SHA-256 hashes so any tampering after signing is
-- detectable:
--
--   document_hash             = sha256(document body when manager signs)
--   manager_signature_hash    = sha256("manager" || document_hash || sig text
--                                       || signed_at || ip || ua)
--   employee_signature_hash   = sha256("employee" || document_hash ||
--                                       manager_signature_hash || sig text ||
--                                       signed_at || ip || ua)
--
-- The employee sign endpoint recomputes document_hash from the current
-- document body and rejects if it drifts from the one captured at manager-
-- sign time — proves the document couldn't have been edited between
-- signatures. Employee hash chains on the manager hash so the two form a
-- linked evidence chain rather than independent entries.
--
-- All three columns are nullable — legacy rows signed before this migration
-- have no hashes, and unsigned rows never had them either.

ALTER TABLE incident_reports
  ADD COLUMN IF NOT EXISTS document_hash            TEXT,
  ADD COLUMN IF NOT EXISTS manager_signature_hash   TEXT,
  ADD COLUMN IF NOT EXISTS employee_signature_hash  TEXT;
