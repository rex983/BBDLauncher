-- App usage by the hour, for Analytics: busiest times (day × hour heat map),
-- visits and how long people stay.
--
-- Every kit app pings pm_record_usage once a minute while a tab is visible and
-- in use (kit usage-beacon.tsx; bbd-pm migration 010 made the function and
-- pm_usage_daily). This adds an hourly row next to the daily one:
--   minutes — active minutes in that hour (several tabs count once)
--   visits  — how many times they came back: a visit starts when the person
--             hadn't been active in that app for 30 minutes or more
-- Only new pings fill it, so visits and the heat map start the day this runs.

create table if not exists public.launcher_usage_hourly (
  launcher_app_id uuid not null references public.launcher_apps(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  hour            timestamptz not null,            -- date_trunc('hour'), UTC
  minutes         integer not null default 0,
  visits          integer not null default 0,
  last_minute     timestamptz not null,
  primary key (launcher_app_id, profile_id, hour)
);
create index if not exists launcher_usage_hourly_hour_idx on public.launcher_usage_hourly (hour);

alter table public.launcher_usage_hourly enable row level security;
revoke all on table public.launcher_usage_hourly from public, anon, authenticated;

-- Same as bbd-pm 010, plus the hourly row. The minute counts only once (the
-- daily row's guard), and only then is the hourly row touched.
create or replace function public.pm_record_usage(p_profile_id uuid, p_audience text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_app uuid;
  v_minute timestamptz := date_trunc('minute', now());
  v_day date := (now() at time zone 'America/New_York')::date;
  v_counted integer;
  v_prev timestamptz;
begin
  select app_id into v_app from launcher_sso_configs where jwt_audience = p_audience limit 1;
  if v_app is null or p_profile_id is null then
    return;
  end if;
  insert into pm_usage_daily as d (launcher_app_id, profile_id, day, minutes, first_minute, last_minute)
  values (v_app, p_profile_id, v_day, 1, v_minute, v_minute)
  on conflict (launcher_app_id, profile_id, day) do update
    set minutes = d.minutes + 1, last_minute = excluded.last_minute
    where d.last_minute < excluded.last_minute;
  get diagnostics v_counted = row_count;
  if v_counted = 0 then
    return;
  end if;

  select h.last_minute into v_prev
    from launcher_usage_hourly h
   where h.launcher_app_id = v_app and h.profile_id = p_profile_id
   order by h.hour desc
   limit 1;

  insert into launcher_usage_hourly as h (launcher_app_id, profile_id, hour, minutes, visits, last_minute)
  values (
    v_app, p_profile_id, date_trunc('hour', v_minute), 1,
    case when v_prev is null or v_minute - v_prev >= interval '30 minutes' then 1 else 0 end,
    v_minute
  )
  on conflict (launcher_app_id, profile_id, hour) do update
    set minutes = h.minutes + 1, visits = h.visits + excluded.visits, last_minute = excluded.last_minute;
end $$;

revoke all on function public.pm_record_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.pm_record_usage(uuid, text) to service_role;

-- Everything the Analytics overview needs since p_since (null: all time), for
-- p_allowed people (null: everyone). Days and hours are Eastern.
--   tracked_since  first hourly row ever (visits and time-of-day start then)
--   totals         minutes, people, person_days (daily); visits, visit_minutes
--                  (hourly, for the average visit); opens (launcher clicks)
--   daily          [{day, minutes, people, visits, opens}]
--   hours          [{dow 1=Mon..7, hour 0-23, minutes, visits, opens}]
--   apps           [{app_id, name, minutes, people, days, visits, visit_minutes, last_seen}]
--   users          [{profile_id, email, name, role, office, minutes, days, visits, visit_minutes, apps, top_app, top_app_minutes, last_seen}]
create or replace function public.launcher_usage_report(p_since timestamptz, p_allowed uuid[])
returns jsonb
language sql stable security definer set search_path = public as $$
  with
  d as (
    select * from pm_usage_daily
     where (p_since is null or day >= (p_since at time zone 'America/New_York')::date)
       and (p_allowed is null or profile_id = any(p_allowed))
  ),
  h as (
    select *, hour at time zone 'America/New_York' as et from launcher_usage_hourly
     where (p_since is null or hour >= date_trunc('hour', p_since))
       and (p_allowed is null or profile_id = any(p_allowed))
  ),
  o as (
    select created_at at time zone 'America/New_York' as et from launcher_sso_audit_log
     where event_type in ('app_launch', 'link_click') and coalesce(app_id, link_id) is not null
       and (p_since is null or created_at >= p_since)
       and (p_allowed is null or user_id = any(p_allowed))
  ),
  days as (
    select day, sum(minutes)::int as minutes, count(distinct profile_id)::int as people from d group by day
  ),
  hv as (select et::date as day, sum(visits)::int as visits from h group by 1),
  od as (select et::date as day, count(*)::int as opens from o group by 1),
  user_app as (
    select profile_id, launcher_app_id, sum(minutes)::int as minutes from d group by 1, 2
  ),
  user_top as (
    select distinct on (ua.profile_id) ua.profile_id, a.name as top_app, ua.minutes as top_app_minutes
      from user_app ua left join launcher_apps a on a.id = ua.launcher_app_id
     order by ua.profile_id, ua.minutes desc
  ),
  user_h as (
    select profile_id, sum(visits)::int as visits, sum(minutes)::int as visit_minutes from h group by 1
  ),
  app_h as (
    select launcher_app_id, sum(visits)::int as visits, sum(minutes)::int as visit_minutes from h group by 1
  )
  select jsonb_build_object(
    'tracked_since', (select min(hour) from launcher_usage_hourly),
    'totals', jsonb_build_object(
      'minutes', coalesce((select sum(minutes) from d), 0),
      'people', (select count(distinct profile_id) from d),
      'person_days', (select count(distinct (profile_id, day)) from d),
      'visits', coalesce((select sum(visits) from h), 0),
      'visit_minutes', coalesce((select sum(minutes) from h), 0),
      'opens', (select count(*) from o)
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', x.day, 'minutes', coalesce(days.minutes, 0), 'people', coalesce(days.people, 0),
               'visits', coalesce(hv.visits, 0), 'opens', coalesce(od.opens, 0)) order by x.day)
        from (select day from days union select day from hv union select day from od) x
        left join days on days.day = x.day
        left join hv on hv.day = x.day
        left join od on od.day = x.day
    ), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'minutes', minutes, 'visits', visits, 'opens', opens))
        from (
          select dow, hr, sum(minutes)::int as minutes, sum(visits)::int as visits, sum(opens)::int as opens
            from (
              select extract(isodow from et)::int as dow, extract(hour from et)::int as hr, minutes, visits, 0 as opens from h
              union all
              select extract(isodow from et)::int, extract(hour from et)::int, 0, 0, 1 from o
            ) c
           group by dow, hr
        ) g
    ), '[]'::jsonb),
    'apps', coalesce((
      select jsonb_agg(r order by r.minutes desc) from (
        select d.launcher_app_id as app_id, coalesce(a.name, '(deleted app)') as name,
               sum(d.minutes)::int as minutes, count(distinct d.profile_id)::int as people,
               count(distinct d.day)::int as days,
               coalesce(max(app_h.visits), 0) as visits, coalesce(max(app_h.visit_minutes), 0) as visit_minutes,
               max(d.last_minute) as last_seen
          from d
          left join launcher_apps a on a.id = d.launcher_app_id
          left join app_h on app_h.launcher_app_id = d.launcher_app_id
         group by d.launcher_app_id, a.name
      ) r
    ), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(r order by r.minutes desc) from (
        select d.profile_id, coalesce(p.email, '(unknown user)') as email, p.full_name as name,
               coalesce(p.role, 'unknown') as role, p.office,
               sum(d.minutes)::int as minutes, count(distinct d.day)::int as days,
               coalesce(max(user_h.visits), 0) as visits, coalesce(max(user_h.visit_minutes), 0) as visit_minutes,
               count(distinct d.launcher_app_id)::int as apps,
               max(user_top.top_app) as top_app, max(user_top.top_app_minutes) as top_app_minutes,
               max(d.last_minute) as last_seen
          from d
          left join user_h on user_h.profile_id = d.profile_id
          left join user_top on user_top.profile_id = d.profile_id
          left join profiles p on p.id = d.profile_id
         group by d.profile_id, p.email, p.full_name, p.role, p.office
      ) r
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.launcher_usage_report(timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.launcher_usage_report(timestamptz, uuid[]) to service_role;
