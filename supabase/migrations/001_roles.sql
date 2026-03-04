-- Migration 1: Roles
-- Add 'bst' and 'rnd' to the profiles.role CHECK constraint and create launcher_roles table

-- Update the CHECK constraint on profiles.role to include new roles
-- First drop existing constraint, then add updated one
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'manager', 'sales_rep', 'bst', 'rnd'));

-- Create launcher_roles table
CREATE TABLE IF NOT EXISTS launcher_roles (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed roles
INSERT INTO launcher_roles (name, display_name, description, is_admin) VALUES
  ('admin', 'Administrator', 'Full system access', TRUE),
  ('manager', 'Manager', 'Team management and reporting access', FALSE),
  ('sales_rep', 'Sales Representative', 'Sales tools and CRM access', FALSE),
  ('bst', 'BST', 'Building Success Team', FALSE),
  ('rnd', 'R&D', 'Research and Development tools', FALSE)
ON CONFLICT (name) DO NOTHING;
