-- Onboarding: people on checklist items, and a "Notify on Slack" per item.
--
-- A manager's new hire tags only Rex (he creates the profiles). Later steps
-- happen during training: the manager (or an admin) puts people on those
-- checklist items and presses "Notify on Slack" when it's time, which tags
-- them in Slack and rings their bell. People on an item can open the
-- request (name, hire date and the checklist only) and tick their items.
--
--   assignee_ids   who does the item. On the default checklist it's who new
--                  requests start with; each request keeps its own copy.
--   notified_at    last time "Notify on Slack" was pressed for the item.
--
-- The checklist also stays open after the request closes at 7 days (the
-- login and documents still close then). Not audited (see 065). Re-runnable.

alter table public.onboarding_template_tasks
  add column if not exists assignee_ids uuid[] not null default '{}';

alter table public.onboarding_tasks
  add column if not exists assignee_ids uuid[] not null default '{}',
  add column if not exists notified_at timestamptz,
  add column if not exists notified_by_name text;

create index if not exists onboarding_tasks_assignees_idx on public.onboarding_tasks using gin (assignee_ids);

-- The first tag on a new hire is Rex only.
update public.onboarding_settings
set tag_profile_ids = coalesce(
  (select array_agg(id) from public.profiles where lower(email) = 'rex@bigbuildingsdirect.com'),
  '{}')
where id = 1;
