-- The manufacturer hub's Strapi deposit sync updates manufacturer_config with no
-- person behind it (user_email = 'strapi-sync'), so its changelog rows have no
-- profile id. NOT NULL rejected them, leaving the launcher's history without the
-- 2026-10-19 Strapi deposit changes.
alter table public.manufacturer_config_changelog
  alter column user_id drop not null;
