-- One edit/audit log for every BBD app on the shared database.
--
-- A trigger on each table people edit writes one row per inserted, updated
-- or deleted row: which app, which table and record, which fields changed
-- (old -> new), who did it and when. Because it runs in the database, every
-- write path is covered, including ones the app code forgets to log.
--
-- Who: every app's service-role client sends an `x-audit-actor` header
-- (base64 JSON, launcher kit audit.ts) and `x-audit-app` on writes. The
-- trigger reads them from PostgREST's request.headers. No header means a
-- sync, cron or webhook (source "system"); no request at all means the SQL
-- editor or a migration (source "database").
--
-- Bulk-synced and activity tables (emails, Five9, zips, usage, presence,
-- quiz attempts, other logs) are deliberately not audited.
-- A failure inside the trigger is swallowed with a warning: auditing never
-- blocks a save. Re-runnable.

create table if not exists public.audit_log (
  id               bigint generated always as identity primary key,
  at               timestamptz not null default now(),
  app              text not null,
  table_name       text not null,
  action           text not null check (action in ('insert', 'update', 'delete')),
  row_id           text,
  row_label        text,
  source           text not null check (source in ('user', 'system', 'database')),
  actor_id         text,
  actor_email      text,
  actor_name       text,
  -- set when an admin made the change while viewing the app as someone else
  as_user_id       text,
  as_user_email    text,
  changes          jsonb not null default '{}'::jsonb
);

create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_app_at_idx on public.audit_log (app, at desc);
create index if not exists audit_log_actor_at_idx on public.audit_log (actor_id, at desc);
create index if not exists audit_log_row_idx on public.audit_log (table_name, row_id, at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;

-- ---------- trigger ----------
create or replace function public.audit_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old       jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new       jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row       jsonb := coalesce(v_new, v_old);
  v_ignore    text[] := array['updated_at', 'synced_at', 'search', 'search_tsv', 'edited_at',
                              'last_used_at', 'last_delivery_at', 'last_check_at', 'last_error_at',
                              'last_revealed_at', 'stats_computed_at', 'last_notified_day']
                        || coalesce(string_to_array(nullif(tg_argv[1], ''), ','), '{}');
  v_changes   jsonb := '{}'::jsonb;
  v_key       text;
  v_from      jsonb;
  v_to        jsonb;
  v_headers   jsonb;
  v_actor     jsonb;
  v_source    text;
  v_app       text;
begin
  begin
    for v_key in select jsonb_object_keys(v_row) loop
      continue when v_key = any (v_ignore);
      v_from := case when v_old is not null then v_old -> v_key end;
      v_to   := case when v_new is not null then v_new -> v_key end;
      continue when tg_op = 'UPDATE' and v_from is not distinct from v_to;
      continue when tg_op <> 'UPDATE' and coalesce(v_from, v_to) = 'null'::jsonb;
      -- never copy secrets into the log
      if v_key ~* '(secret|token|password|hash|ciphertext|wrapped_dek|auth_tag|^iv$|cert$)' then
        v_from := case when v_from is not null then '"[hidden]"'::jsonb end;
        v_to   := case when v_to is not null then '"[hidden]"'::jsonb end;
      end if;
      -- big blobs (editor JSON, pricing matrices) are summarised
      if v_from is not null and length(v_from::text) > 4000 then
        v_from := to_jsonb(format('[%s characters]', length(v_from::text)));
      end if;
      if v_to is not null and length(v_to::text) > 4000 then
        v_to := to_jsonb(format('[%s characters]', length(v_to::text)));
      end if;
      v_changes := v_changes || jsonb_build_object(v_key,
        case tg_op when 'INSERT' then jsonb_build_object('to', v_to)
                   when 'DELETE' then jsonb_build_object('from', v_from)
                   else jsonb_build_object('from', v_from, 'to', v_to) end);
    end loop;

    if tg_op = 'UPDATE' and v_changes = '{}'::jsonb then
      return null; -- only ignored columns changed (or nothing did)
    end if;

    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
    if v_headers is null then
      v_source := 'database';
    elsif v_headers ? 'x-audit-actor' then
      v_actor := convert_from(decode(v_headers ->> 'x-audit-actor', 'base64'), 'UTF8')::jsonb;
      v_source := 'user';
    else
      v_source := 'system';
    end if;
    v_app := coalesce(nullif(v_headers ->> 'x-audit-app', ''), tg_argv[0], tg_table_name);

    insert into public.audit_log
      (app, table_name, action, row_id, row_label, source,
       actor_id, actor_email, actor_name, as_user_id, as_user_email, changes)
    values (
      v_app,
      tg_table_name,
      lower(tg_op),
      coalesce(v_row ->> 'id', v_row ->> 'profile_id', v_row ->> 'key', v_row ->> 'mailbox',
               v_row ->> 'alias', v_row ->> 'slug'),
      left(coalesce(v_row ->> 'name', v_row ->> 'title', v_row ->> 'full_name', v_row ->> 'display_name',
                    v_row ->> 'label', v_row ->> 'employee_name', v_row ->> 'customer_name',
                    v_row ->> 'quote_number', v_row ->> 'ticket_number', v_row ->> 'headline',
                    v_row ->> 'email', v_row ->> 'slug', v_row ->> 'mailbox', v_row ->> 'key',
                    v_row ->> 'alias', v_row ->> 'filename'), 200),
      v_source,
      v_actor ->> 'id', v_actor ->> 'email', v_actor ->> 'name',
      v_actor ->> 'asId', v_actor ->> 'asEmail',
      v_changes
    );
  exception when others then
    raise warning 'audit_capture(%): %', tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.audit_capture() from public, anon, authenticated;

-- ---------- attach ----------
-- [table, app shown when the write didn't say, extra columns to ignore]
do $$
declare
  t text[];
  targets text[][] := array[
    -- BBD Launcher
    ['profiles', 'BBD Launcher', ''],
    ['launcher_apps', 'BBD Launcher', ''],
    ['launcher_departments', 'BBD Launcher', ''],
    ['launcher_links', 'BBD Launcher', ''],
    ['launcher_motivational_quotes', 'BBD Launcher', ''],
    ['launcher_offices', 'BBD Launcher', ''],
    ['launcher_role_app_access', 'BBD Launcher', ''],
    ['launcher_roles', 'BBD Launcher', ''],
    ['launcher_sections', 'BBD Launcher', ''],
    ['launcher_sso_configs', 'BBD Launcher', ''],
    ['launcher_team_members', 'BBD Launcher', ''],
    ['launcher_teams', 'BBD Launcher', ''],
    ['launcher_user_access', 'BBD Launcher', ''],
    ['mail_monitor_mailboxes', 'BBD Launcher', 'last_error'],
    ['manufacturer_config', 'BBD Launcher', ''],
    ['incident_reports', 'BBD Launcher', ''],
    ['offboarding_cases', 'BBD Launcher', ''],
    ['offboarding_checklist_items', 'BBD Launcher', ''],
    ['offboarding_sections', 'BBD Launcher', ''],
    ['offboarding_tasks', 'BBD Launcher', ''],
    ['office_memos', 'BBD Launcher', ''],
    ['office_memo_recipients', 'BBD Launcher', ''],
    ['time_punches', 'BBD Launcher', ''],
    ['time_off_requests', 'BBD Launcher', ''],
    ['time_extensions', 'BBD Launcher', ''],
    ['work_schedules', 'BBD Launcher', ''],
    -- Employee Handbook
    ['handbook_chapter', 'Employee Handbook', ''],
    ['handbook_section', 'Employee Handbook', ''],
    ['handbook_part', 'Employee Handbook', ''],
    ['handbook_program', 'Employee Handbook', ''],
    ['handbook_trainee', 'Employee Handbook', ''],
    ['handbook_editor', 'Employee Handbook', ''],
    ['handbook_assignment', 'Employee Handbook', ''],
    ['handbook_acknowledgement', 'Employee Handbook', ''],
    ['handbook_quiz_question', 'Employee Handbook', ''],
    ['handbook_flashcard', 'Employee Handbook', ''],
    ['handbook_flashcard_deck', 'Employee Handbook', ''],
    -- Helpdesk
    ['helpdesk_tickets', 'Helpdesk', ''],
    ['helpdesk_ticket_comments', 'Helpdesk', ''],
    ['helpdesk_ticket_attachments', 'Helpdesk', ''],
    ['helpdesk_ticket_merges', 'Helpdesk', ''],
    ['helpdesk_staff', 'Helpdesk', ''],
    -- Manufacturer Hub
    ['mfr_hub_manufacturer', 'BBD Manufacturer Hub', ''],
    ['mfr_hub_page', 'BBD Manufacturer Hub', ''],
    ['mfr_hub_building', 'BBD Manufacturer Hub', ''],
    ['mfr_hub_building_photo', 'BBD Manufacturer Hub', ''],
    ['mfr_hub_coverage_area', 'BBD Manufacturer Hub', ''],
    ['mfr_hub_coverage_zone', 'BBD Manufacturer Hub', ''],
    ['mfr_hub_plant', 'BBD Manufacturer Hub', ''],
    ['mfr_hub_pricing_rule', 'BBD Manufacturer Hub', ''],
    ['mfr_hub_file', 'BBD Manufacturer Hub', ''],
    ['mfr_hub_field', 'BBD Manufacturer Hub', ''],
    ['mfr_hub_api_key', 'BBD Manufacturer Hub', ''],
    ['mfr_hub_webhook', 'BBD Manufacturer Hub', 'last_status,failure_count'],
    ['mfr_hub_review_item', 'BBD Manufacturer Hub', ''],
    -- Manufacturer Questions
    ['mq_manager_reviews', 'Manufacturer Questions', ''],
    -- Retired Employees
    ['mbox_archives', 'Retired Employees', 'message_count,with_attachments_count,latest_sent_at,compressed_bytes'],
    ['mbox_archive_notes', 'Retired Employees', ''],
    ['mbox_share_links', 'Retired Employees', ''],
    -- Project Manager (launcher/vercel/github are sync snapshots)
    ['pm_apps', 'Project Manager', 'launcher,vercel,github'],
    ['pm_links', 'Project Manager', ''],
    ['pm_notes', 'Project Manager', ''],
    ['pm_tasks', 'Project Manager', ''],
    ['pm_time_entries', 'Project Manager', ''],
    ['pm_sync_ignore', 'Project Manager', ''],
    ['pm_secrets', 'Project Manager', ''],
    ['pm_secret_acl', 'Project Manager', ''],
    -- Rep Insights (settings people change, not the synced data)
    ['rep_aliases', 'Rep Insights', ''],
    ['rep_column_prefs', 'Rep Insights', ''],
    ['rep_grade_weights', 'Rep Insights', ''],
    ['rep_groups', 'Rep Insights', ''],
    ['rep_group_members', 'Rep Insights', ''],
    ['rep_match_dismissals', 'Rep Insights', ''],
    ['rep_pay_ledger', 'Rep Insights', ''],
    ['rep_profile_overrides', 'Rep Insights', ''],
    ['rep_settings', 'Rep Insights', ''],
    ['rep_reps', 'Rep Insights', ''],
    -- ASC Engineering
    ['asce_app_config', 'ASC Engineering', ''],
    ['asce_regions', 'ASC Engineering', ''],
    ['asce_uploads', 'ASC Engineering', ''],
    -- PSB Pricing
    ['psb_config', 'PSB Pricing', ''],
    ['psb_customers', 'PSB Pricing', ''],
    ['psb_quotes', 'PSB Pricing', ''],
    ['psb_regions', 'PSB Pricing', ''],
    ['psb_state_defaults', 'PSB Pricing', ''],
    ['psb_uploads', 'PSB Pricing', ''],
    -- QSB Pricing
    ['qsb_customers', 'QSB Pricing', ''],
    ['qsb_quotes', 'QSB Pricing', '']
  ];
begin
  foreach t slice 1 in array targets loop
    if to_regclass('public.' || t[1]) is null then
      raise notice 'audit: % not found, skipped', t[1];
      continue;
    end if;
    execute format('drop trigger if exists audit_capture on public.%I', t[1]);
    execute format(
      'create trigger audit_capture after insert or update or delete on public.%I
         for each row execute function public.audit_capture(%L, %L)',
      t[1], t[2], t[3]);
  end loop;
end $$;

-- ---------- viewer helpers ----------
-- Filter lists for the launcher's /admin/audit page.
create or replace function public.audit_log_facets()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'apps',   coalesce((select jsonb_agg(distinct app order by app) from audit_log), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(distinct table_name order by table_name) from audit_log), '[]'::jsonb),
    'actors', coalesce((select jsonb_agg(a order by a ->> 'name') from (
                select distinct on (actor_id) jsonb_build_object('id', actor_id, 'name', coalesce(actor_name, actor_email), 'email', actor_email) as a
                from audit_log where actor_id is not null order by actor_id, at desc) s), '[]'::jsonb)
  );
$$;

revoke all on function public.audit_log_facets() from public, anon, authenticated;
grant execute on function public.audit_log_facets() to service_role;
