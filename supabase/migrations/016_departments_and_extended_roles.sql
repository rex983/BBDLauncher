-- Migration 16: Departments + extended role taxonomy.
--
-- Adds profiles.department (nullable) so users can be tagged with their
-- functional department alongside office/role. Seeds new roles derived from
-- the Aug-2026 org chart: senior_manager, junior_manager, team_lead,
-- cancellations_dept, revisions_dept. The existing 'manager' role stays for
-- backwards compatibility but new manager-tier hires should use
-- senior_manager or junior_manager.
--
-- Also drops the old profiles.role CHECK constraint (from migration 001) —
-- it hardcoded 5 role names and blocked the /admin/roles-managed custom
-- roles the launcher already supports. launcher_roles is the source of truth.

-- 1. Department column, nullable + constrained to the three known values.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS department TEXT;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_department_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_department_check
  CHECK (department IS NULL OR department IN ('SALES TEAM', 'BST', 'RnD'));

-- 2. Drop the hardcoded role CHECK — launcher_roles is the source of truth
-- for allowed role names, and the /admin/roles UI already lets admins add
-- new ones.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- 3. Seed the new roles from the org chart. is_admin stays FALSE for all;
-- senior_manager / junior_manager get manager-tier privileges via
-- src/lib/auth/permissions.ts, not via the is_admin flag.
INSERT INTO launcher_roles (name, display_name, description, is_admin) VALUES
  ('senior_manager',     'Senior Manager',     'Senior team manager (content + analytics access)', FALSE),
  ('junior_manager',     'Junior Manager',     'Junior team manager (content + analytics access)', FALSE),
  ('team_lead',          'Team Lead',          'Sales team lead',                                   FALSE),
  ('cancellations_dept', 'Cancellations Dept', 'BST cancellations department',                      FALSE),
  ('revisions_dept',     'Revisions Dept',     'BST revisions department',                          FALSE)
ON CONFLICT (name) DO NOTHING;
