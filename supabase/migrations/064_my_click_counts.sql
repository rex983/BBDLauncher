-- Dashboard "Sort by": how often one person has opened each app and link.
--
-- Counts that person's own app_launch + link_click rows in
-- launcher_sso_audit_log (View as launches are logged as app_launch_view_as
-- and don't count). The dashboard calls it with the service role for the
-- person being shown, so it is closed to everyone else.

create or replace function public.launcher_my_click_counts(p_user_id uuid)
returns table (kind text, id uuid, clicks bigint, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select
    case when event_type = 'app_launch' then 'app' else 'link' end as kind,
    coalesce(app_id, link_id) as id,
    count(*) as clicks,
    max(created_at) as last_at
  from launcher_sso_audit_log
  where user_id = p_user_id
    and (
      (event_type = 'app_launch' and app_id is not null)
      or (event_type = 'link_click' and link_id is not null)
    )
  group by 1, 2;
$$;

revoke all on function public.launcher_my_click_counts(uuid) from public, anon, authenticated;
grant execute on function public.launcher_my_click_counts(uuid) to service_role;
