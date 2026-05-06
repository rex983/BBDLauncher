-- Migration 8: Office filter for apps and links
-- NULL office = visible to everyone (subject to role gating).
-- 'Harbor' / 'Marion' = visible only to users assigned to that office.

ALTER TABLE launcher_apps
  ADD COLUMN IF NOT EXISTS office TEXT
  CHECK (office IS NULL OR office IN ('Harbor', 'Marion'));

ALTER TABLE launcher_links
  ADD COLUMN IF NOT EXISTS office TEXT
  CHECK (office IS NULL OR office IN ('Harbor', 'Marion'));

CREATE INDEX IF NOT EXISTS launcher_apps_office_idx ON launcher_apps(office);
CREATE INDEX IF NOT EXISTS launcher_links_office_idx ON launcher_links(office);
