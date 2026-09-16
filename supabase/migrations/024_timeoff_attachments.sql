-- Migration 24: time-off document attachments.
--
-- Adds an `attachments` JSONB column on time_off_requests holding an array
-- of file metadata:
--
--   [
--     { "path": "<profileId>/<uuid>-<filename>",
--       "filename": "doctor-note.pdf",
--       "size": 12345,
--       "mime": "application/pdf" },
--     ...
--   ]
--
-- The actual bytes live in a private Storage bucket. All reads/writes go
-- through the Next.js API using the service-role key — no direct client
-- access to the bucket, and download links are signed on demand and scoped
-- to viewers with time-data access for the requester.

ALTER TABLE time_off_requests
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Storage bucket for the attached documents. Private (`public = false`) —
-- we never expose bucket URLs directly, only short-lived signed URLs via
-- /api/timeoff/attachments/[...path].
INSERT INTO storage.buckets (id, name, public)
VALUES ('time-off-attachments', 'time-off-attachments', false)
ON CONFLICT (id) DO NOTHING;
