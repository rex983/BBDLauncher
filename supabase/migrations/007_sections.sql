-- Migration 7: Sections
-- Admin-managed sections to organize launcher apps on the dashboard.

CREATE TABLE IF NOT EXISTS launcher_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Nullable section_id on apps — apps with NULL render in an "Unsorted" bucket.
ALTER TABLE launcher_apps
  ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES launcher_sections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS launcher_apps_section_id_idx ON launcher_apps(section_id);

DROP TRIGGER IF EXISTS launcher_sections_updated_at ON launcher_sections;
CREATE TRIGGER launcher_sections_updated_at
  BEFORE UPDATE ON launcher_sections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE launcher_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sections readable by authenticated users"
  ON launcher_sections FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Sections writable by admins"
  ON launcher_sections FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');
