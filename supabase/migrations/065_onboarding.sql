-- Onboarding (People → Onboarding).
--
-- A manager fills in a new hire (name, hire date, date of birth, documents)
-- and an admin works a fixed checklist: prepare laptop, create the Gmail,
-- Strapi and launcher accounts, then enters the new hire's email and
-- password. This is a to-do list for the admin, NOT a profile: nothing here
-- touches profiles.
--
-- Nothing is kept:
--   * every request expires 7 days after it was opened. The hourly cron
--     /api/cron/onboarding-purge deletes the row, its documents (bucket
--     onboarding-docs, folder {id}/) and its bell notifications; reads also
--     hide expired rows, so a late cron never shows stale data.
--   * the password is stored encrypted (AES-256-GCM, key derived from
--     AUTH_SECRET) and is wiped the moment the requesting manager reveals it.
--   * the table is deliberately NOT in the 060 audit trigger list, so no
--     copy of these fields lands in audit_log.
--
-- Only the launcher's service-role client reads or writes it. Re-runnable.

create table if not exists public.onboarding_requests (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default (now() + interval '7 days'),
  created_by          uuid not null,
  created_by_name     text,
  first_name          text not null check (length(first_name) between 1 and 100),
  last_name           text not null check (length(last_name) between 1 and 100),
  hire_date           date not null,
  dob                 date not null,
  -- checklist: when each step was ticked (null = not done)
  laptop_at           timestamptz,
  gmail_at            timestamptz,
  strapi_at           timestamptz,
  launcher_at         timestamptz,
  -- login handed back to the manager
  account_email       text,
  password_cipher     text,
  password_set_at     timestamptz,
  password_viewed_at  timestamptz
);

create index if not exists onboarding_requests_expires_idx on public.onboarding_requests (expires_at);
create index if not exists onboarding_requests_created_by_idx on public.onboarding_requests (created_by);

alter table public.onboarding_requests enable row level security;
revoke all on public.onboarding_requests from anon, authenticated;

-- Private bucket for the manager's documents (ID, I-9, offer letter, ...).
insert into storage.buckets (id, name, public)
values ('onboarding-docs', 'onboarding-docs', false)
on conflict (id) do nothing;
