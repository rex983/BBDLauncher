-- Presence (058) follow-up: background tabs now stay listed as "away" and
-- ping about once a minute (browsers throttle background timers), so a tab
-- counts as gone after 100s instead of 45s; rows are swept after 3 minutes.

create or replace function public.launcher_presence_ping(
  p_profile_id uuid,
  p_audience   text,
  p_tab_id     text,
  p_path       text,
  p_idle       boolean default false,
  p_leave      boolean default false
)
returns table (profile_id uuid, name text, same_page boolean, idle boolean)
language plpgsql security definer set search_path = public as $$
begin
  delete from launcher_presence lp where lp.seen_at < now() - interval '3 minutes';

  if p_leave then
    delete from launcher_presence lp
      where lp.profile_id = p_profile_id and lp.audience = p_audience and lp.tab_id = p_tab_id;
    return;
  end if;

  insert into launcher_presence as lp (profile_id, audience, tab_id, path, idle, seen_at)
  values (p_profile_id, p_audience, left(p_tab_id, 64), left(p_path, 512), p_idle, now())
  on conflict on constraint launcher_presence_pkey do update
    set path = excluded.path, idle = excluded.idle, seen_at = excluded.seen_at;

  return query
    select lp.profile_id,
           coalesce(nullif(trim(pr.full_name), ''), pr.email)::text,
           bool_or(lp.path = p_path),
           bool_and(lp.idle)
      from launcher_presence lp
      join profiles pr on pr.id = lp.profile_id
     where lp.audience = p_audience
       and lp.seen_at > now() - interval '100 seconds'
       and lp.profile_id <> p_profile_id
       and coalesce(pr.is_active, true)
     group by lp.profile_id, pr.full_name, pr.email
     order by 3 desc, 2;
end $$;

revoke execute on function public.launcher_presence_ping(uuid, text, text, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.launcher_presence_ping(uuid, text, text, text, boolean, boolean)
  to service_role;
