-- Onboarding: an editable default checklist and admin-picked people to tag.
--
--   onboarding_template_tasks  the checklist every new request starts with.
--                              Admins add/remove/reorder it on /onboarding
--                              ("Add task"); open requests keep their copy.
--   onboarding_tasks           each request's own copy (deleted with the
--                              request by the FK cascade, so the 7-day purge
--                              still leaves nothing).
--   onboarding_settings        one row: who gets the Slack tag + bell when a
--                              manager submits a new hire (seeded with Rex).
--
-- The old laptop_at/gmail_at/strapi_at/launcher_at columns are copied into
-- onboarding_tasks and left in place until the new code is live; drop them
-- in a later migration. Not audited (see 065). Re-runnable.

create table if not exists public.onboarding_template_tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(title) between 1 and 200),
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.onboarding_tasks (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.onboarding_requests (id) on delete cascade,
  title       text not null,
  position    int not null default 0,
  done_at     timestamptz
);
create index if not exists onboarding_tasks_request_idx on public.onboarding_tasks (request_id, position);

create table if not exists public.onboarding_settings (
  id               int primary key default 1 check (id = 1),
  tag_profile_ids  uuid[] not null default '{}'
);

alter table public.onboarding_template_tasks enable row level security;
alter table public.onboarding_tasks enable row level security;
alter table public.onboarding_settings enable row level security;
revoke all on public.onboarding_template_tasks, public.onboarding_tasks, public.onboarding_settings from anon, authenticated;

-- Seed the default checklist (only when empty).
insert into public.onboarding_template_tasks (title, position)
select t.title, t.position
from (values ('Prepare laptop', 0), ('Create Gmail account', 1), ('Create Strapi account', 2), ('Create launcher account', 3))
  as t(title, position)
where not exists (select 1 from public.onboarding_template_tasks);

-- Tag Rex by default.
insert into public.onboarding_settings (id, tag_profile_ids)
select 1, coalesce(array_agg(id), '{}') from public.profiles where lower(email) = 'rex@bigbuildingsdirect.com'
on conflict (id) do nothing;

-- Open requests: copy the 4 fixed steps into their own task rows.
insert into public.onboarding_tasks (request_id, title, position, done_at)
select r.id, s.title, s.position, s.done_at
from public.onboarding_requests r
cross join lateral (values
  ('Prepare laptop', 0, r.laptop_at),
  ('Create Gmail account', 1, r.gmail_at),
  ('Create Strapi account', 2, r.strapi_at),
  ('Create launcher account', 3, r.launcher_at)
) as s(title, position, done_at)
where not exists (select 1 from public.onboarding_tasks t where t.request_id = r.id);
