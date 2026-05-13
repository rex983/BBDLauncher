-- Migration 10: Expand the profiles.office check constraint to include BST and RnD.
-- The profiles table was originally created by ASC Pricing with
-- CHECK (office IN ('Harbor', 'Marion')). Migration 009 added BST/RnD support to
-- launcher_apps and launcher_links but didn't touch profiles, so assigning a user
-- to BST or RnD still fails with profiles_office_check.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_office_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_office_check
  CHECK (office IS NULL OR office IN ('Harbor', 'Marion', 'BST', 'RnD'));
