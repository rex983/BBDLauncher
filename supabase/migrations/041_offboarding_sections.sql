-- Migration 41: offboarding checklist sections, no assignments.
--
-- The fixed categories (access / data / hardware / hr) become editable,
-- reorderable sections. Template items belong to a section and are ordered
-- within it. The launcher's built-in steps are now ordinary template items
-- (auto_action), so they can be dragged anywhere or removed:
--   deactivate_launcher   one-click "deactivate launcher account"
--   export_launcher_data  one-click "back up launcher records"
--   revoke_apps           expands into one task per launcher app they can open
-- Case tasks snapshot the section name. Task owners/assignees are dropped.

BEGIN;

CREATE TABLE IF NOT EXISTS offboarding_sections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  display_order  INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE offboarding_sections ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_offboarding_sections_updated_at ON offboarding_sections;
CREATE TRIGGER trg_offboarding_sections_updated_at
  BEFORE UPDATE ON offboarding_sections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO offboarding_sections (name, display_order)
SELECT * FROM (VALUES
  ('Phone / communications', 10),
  ('Google Workspace & email', 20),
  ('Apps', 30),
  ('Strapi / pricing apps', 40),
  ('Data & backups', 50),
  ('Equipment', 60),
  ('HR & payroll', 70)
) AS seed(name, display_order)
WHERE NOT EXISTS (SELECT 1 FROM offboarding_sections);

-- ---------------------------------------------------------------------
-- Template items → sections
-- ---------------------------------------------------------------------
ALTER TABLE offboarding_checklist_items
  ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES offboarding_sections(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS auto_action TEXT
    CHECK (auto_action IN ('deactivate_launcher', 'export_launcher_data', 'revoke_apps'));

UPDATE offboarding_checklist_items i
SET section_id = s.id
FROM offboarding_sections s
WHERE i.section_id IS NULL
  AND s.name = CASE
    WHEN i.system IN ('Phone system', 'Slack') OR i.title ILIKE '%company phone%' THEN 'Phone / communications'
    WHEN i.category = 'access' AND i.system = 'Google Workspace' THEN 'Google Workspace & email'
    WHEN i.category = 'access' THEN 'Apps'
    WHEN i.category = 'data' THEN 'Data & backups'
    WHEN i.category = 'hardware' THEN 'Equipment'
    ELSE 'HR & payroll'
  END;

-- Category was only needed to place existing items above.
ALTER TABLE offboarding_checklist_items
  ALTER COLUMN system DROP NOT NULL,
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS default_assignee;

-- The launcher's built-in steps, now draggable template items.
INSERT INTO offboarding_checklist_items (title, system, instructions, auto_action, section_id, display_order)
SELECT v.title, 'BBD Launcher', v.instructions, v.auto_action, s.id, v.display_order
FROM (VALUES
  ('Deactivate BBD Launcher account',
   'Signs them out everywhere and blocks sign-in to the launcher and every app it signs into. Their timesheets, time off and incident records are kept.',
   'deactivate_launcher', 'Apps', 0),
  ('Revoke access to each launcher app',
   'Becomes one task per launcher app they can open when a case starts.',
   'revoke_apps', 'Apps', 1),
  ('Back up launcher records',
   'Saves their profile, timesheets, schedules, time off, incident reports, memo acknowledgements and app-launch history as a JSON file attached to the case.',
   'export_launcher_data', 'Data & backups', 0)
) AS v(title, instructions, auto_action, section_name, display_order)
JOIN offboarding_sections s ON s.name = v.section_name
WHERE NOT EXISTS (SELECT 1 FROM offboarding_checklist_items WHERE auto_action IS NOT NULL);

INSERT INTO offboarding_checklist_items (title, system, instructions, section_id, display_order)
SELECT 'Block their Strapi account', 'Strapi',
       'Strapi admin → Users → the employee → Blocked (or delete). Reassign any content they own.',
       s.id, 10
FROM offboarding_sections s
WHERE s.name = 'Strapi / pricing apps'
  AND NOT EXISTS (SELECT 1 FROM offboarding_checklist_items WHERE system = 'Strapi');

-- Anything left over lands in the first section.
UPDATE offboarding_checklist_items
SET section_id = (SELECT id FROM offboarding_sections ORDER BY display_order LIMIT 1)
WHERE section_id IS NULL;

ALTER TABLE offboarding_checklist_items ALTER COLUMN section_id SET NOT NULL;

-- ---------------------------------------------------------------------
-- Case tasks: section name snapshot, no assignees
-- ---------------------------------------------------------------------
ALTER TABLE offboarding_tasks ADD COLUMN IF NOT EXISTS section TEXT;

UPDATE offboarding_tasks
SET section = CASE category
  WHEN 'access' THEN 'Apps'
  WHEN 'data' THEN 'Data & backups'
  WHEN 'hardware' THEN 'Equipment'
  ELSE 'HR & payroll'
END
WHERE section IS NULL;

ALTER TABLE offboarding_tasks
  ALTER COLUMN section SET DEFAULT 'Other',
  ALTER COLUMN section SET NOT NULL,
  ALTER COLUMN system DROP NOT NULL,
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS assigned_to;

COMMIT;
