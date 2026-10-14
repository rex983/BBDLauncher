-- Migration 47: SQL aggregation for the analytics drill-downs, and
-- scope-filtered reads for the management time analytics.
--
-- /api/analytics/[kind]/[id] and /api/analytics/users/[id] used to page
-- every matching launcher_sso_audit_log row into Node (up to 200k rows) and
-- aggregate there; office-scoped viewers also sent every profile id in their
-- office as a `user_id=in.(...)` URL filter. These functions do the same
-- aggregation in Postgres (same style as get_launcher_analytics, migration
-- 25) and filter by office with a join, returning the fully-shaped JSON.
--
-- /api/management/analytics/time sent every in-scope profile id as an
-- `in.(...)` URL filter on time_punches and time_off_requests. The weekly
-- hours maths stays in TypeScript (timezone-aware punch pairing), but the
-- scope filter moves into SQL via get_scoped_time_punches /
-- get_scoped_time_off.
--
-- All functions are SECURITY INVOKER and executable by service_role only.
--
-- Apply BEFORE deploying the code that calls them.

BEGIN;

-- Drill-down indexes. (app_id) and (user_id) single-column indexes exist
-- from migration 3; these cover the filter + newest-first ordering.
CREATE INDEX IF NOT EXISTS idx_audit_log_app_event_created
  ON launcher_sso_audit_log (app_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_link_event_created
  ON launcher_sso_audit_log (link_id, event_type, created_at DESC)
  WHERE link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_user_created
  ON launcher_sso_audit_log (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Destination drill-down (one app or one link).
--
-- Contract (the Next.js caller adds kind / destination / range / since):
--   {
--     totals: { clicks, unique_users, first_click, last_click },
--     users: [ { user_id, email, name, role, office, clicks,
--                first_click, last_click } ]                -- clicks DESC
--     audit_log: up to 500 { id, created_at, user_id, email, name,
--                            ip_address, user_agent }       -- created_at DESC
--     audit_log_truncated: boolean
--   }
--
-- p_kind   'apps' | 'links'
-- p_since  NULL = all time
-- p_office NULL = no scope filter; otherwise only events from users whose
--          profiles.office = p_office.
-- Deleted users show email '(unknown user)', role 'unknown' (matches the JS).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_launcher_destination_analytics(
  p_kind TEXT,
  p_dest_id UUID,
  p_since TIMESTAMPTZ,
  p_office TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSONB;
BEGIN
  IF p_kind NOT IN ('apps', 'links') THEN
    RAISE EXCEPTION 'invalid kind %', p_kind;
  END IF;

  WITH
    events AS (
      SELECT a.id, a.user_id, a.created_at, a.ip_address, a.user_agent
      FROM launcher_sso_audit_log a
      WHERE (
          (p_kind = 'apps'  AND a.app_id  = p_dest_id AND a.event_type = 'app_launch')
          OR
          (p_kind = 'links' AND a.link_id = p_dest_id AND a.event_type = 'link_click')
        )
        AND (p_since IS NULL OR a.created_at >= p_since)
        AND (
          p_office IS NULL
          OR EXISTS (
            SELECT 1 FROM profiles sp
            WHERE sp.id = a.user_id AND sp.office = p_office
          )
        )
    ),
    user_agg AS (
      SELECT
        e.user_id,
        COALESCE(p.email, '(unknown user)') AS email,
        p.full_name AS name,
        COALESCE(p.role, 'unknown') AS role,
        p.office AS office,
        COUNT(*)::BIGINT AS clicks,
        MIN(e.created_at) AS first_click,
        MAX(e.created_at) AS last_click
      FROM events e
      LEFT JOIN profiles p ON p.id = e.user_id
      GROUP BY e.user_id, p.email, p.full_name, p.role, p.office
    ),
    recent AS (
      SELECT
        e.id,
        e.created_at,
        e.user_id,
        COALESCE(p.email, '(unknown user)') AS email,
        p.full_name AS name,
        e.ip_address,
        e.user_agent
      FROM events e
      LEFT JOIN profiles p ON p.id = e.user_id
      ORDER BY e.created_at DESC
      LIMIT 500
    ),
    totals AS (
      SELECT
        COUNT(*)::BIGINT                 AS clicks,
        COUNT(DISTINCT user_id)::BIGINT  AS unique_users,
        MIN(created_at)                  AS first_click,
        MAX(created_at)                  AS last_click
      FROM events
    )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'clicks',       t.clicks,
      'unique_users', t.unique_users,
      'first_click',  t.first_click,
      'last_click',   t.last_click
    ),
    'users', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'user_id',     user_id,
          'email',       email,
          'name',        name,
          'role',        role,
          'office',      office,
          'clicks',      clicks,
          'first_click', first_click,
          'last_click',  last_click
        )
        ORDER BY clicks DESC, last_click DESC
      )
      FROM user_agg
    ), '[]'::JSONB),
    'audit_log', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         id,
          'created_at', created_at,
          'user_id',    user_id,
          'email',      email,
          'name',       name,
          'ip_address', ip_address,
          'user_agent', user_agent
        )
        ORDER BY created_at DESC
      )
      FROM recent
    ), '[]'::JSONB),
    'audit_log_truncated', t.clicks > 500
  )
  INTO result
  FROM totals t;

  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- User drill-down (everything one person launched / clicked).
--
-- Contract (the Next.js caller adds user / user_id / range / since):
--   {
--     totals: { events, unique_destinations, app_launches, link_clicks,
--               first_event, last_event },
--     destinations: [ { id, name, kind:'app'|'link', count,
--                       first_used, last_used } ]            -- count DESC
--     audit_log: up to 500 { id, created_at, destination_id,
--                            destination_name, kind, ip_address,
--                            user_agent }                    -- created_at DESC
--     audit_log_truncated: boolean
--   }
--
-- Only event_type IN ('app_launch','link_click'). `events` counts every such
-- row; destinations / app_launches / link_clicks only count rows that carry
-- the matching target id (same as the JS it replaces).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_launcher_user_analytics(
  p_user_id UUID,
  p_since TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSONB;
BEGIN
  WITH
    events AS (
      SELECT
        a.id,
        a.app_id,
        a.link_id,
        a.event_type,
        a.created_at,
        a.ip_address,
        a.user_agent,
        CASE
          WHEN a.event_type = 'app_launch' AND a.app_id  IS NOT NULL THEN 'app'
          WHEN a.event_type = 'link_click' AND a.link_id IS NOT NULL THEN 'link'
          ELSE NULL
        END AS valid_kind
      FROM launcher_sso_audit_log a
      WHERE a.user_id = p_user_id
        AND a.event_type IN ('app_launch', 'link_click')
        AND (p_since IS NULL OR a.created_at >= p_since)
    ),
    dest_agg AS (
      SELECT
        CASE WHEN e.valid_kind = 'app' THEN e.app_id ELSE e.link_id END AS id,
        CASE
          WHEN e.valid_kind = 'app' THEN COALESCE(la.name, '(deleted app)')
          ELSE COALESCE(ll.name, '(deleted link)')
        END AS name,
        e.valid_kind AS kind,
        COUNT(*)::BIGINT AS cnt,
        MIN(e.created_at) AS first_used,
        MAX(e.created_at) AS last_used
      FROM events e
      LEFT JOIN launcher_apps  la ON e.valid_kind = 'app'  AND la.id = e.app_id
      LEFT JOIN launcher_links ll ON e.valid_kind = 'link' AND ll.id = e.link_id
      WHERE e.valid_kind IS NOT NULL
      GROUP BY 1, 2, 3
    ),
    recent AS (
      SELECT
        e.id,
        e.created_at,
        CASE WHEN e.event_type = 'link_click' THEN e.link_id ELSE e.app_id END
          AS destination_id,
        CASE
          WHEN e.event_type = 'link_click' THEN COALESCE(ll.name, '(deleted link)')
          ELSE COALESCE(la.name, '(deleted app)')
        END AS destination_name,
        CASE WHEN e.event_type = 'link_click' THEN 'link' ELSE 'app' END AS kind,
        e.ip_address,
        e.user_agent
      FROM events e
      LEFT JOIN launcher_apps  la ON la.id = e.app_id
      LEFT JOIN launcher_links ll ON ll.id = e.link_id
      ORDER BY e.created_at DESC
      LIMIT 500
    ),
    totals AS (
      SELECT
        COUNT(*)::BIGINT                                          AS events,
        COUNT(*) FILTER (WHERE valid_kind = 'app')::BIGINT        AS app_launches,
        COUNT(*) FILTER (WHERE valid_kind = 'link')::BIGINT       AS link_clicks,
        MIN(created_at)                                           AS first_event,
        MAX(created_at)                                           AS last_event
      FROM events
    )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'events',              t.events,
      'unique_destinations', (SELECT COUNT(*)::BIGINT FROM dest_agg),
      'app_launches',        t.app_launches,
      'link_clicks',         t.link_clicks,
      'first_event',         t.first_event,
      'last_event',          t.last_event
    ),
    'destinations', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',         id,
          'name',       name,
          'kind',       kind,
          'count',      cnt,
          'first_used', first_used,
          'last_used',  last_used
        )
        ORDER BY cnt DESC, last_used DESC
      )
      FROM dest_agg
    ), '[]'::JSONB),
    'audit_log', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',               id,
          'created_at',       created_at,
          'destination_id',   destination_id,
          'destination_name', destination_name,
          'kind',             kind,
          'ip_address',       ip_address,
          'user_agent',       user_agent
        )
        ORDER BY created_at DESC
      )
      FROM recent
    ), '[]'::JSONB),
    'audit_log_truncated', t.events > 500
  )
  INTO result
  FROM totals t;

  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Time analytics scope filters. Same rule as scopeProfilesQuery()
-- (src/lib/auth/scope-check.ts): active only unless p_include_inactive, and
-- department / office equality when given. Callers page and filter the
-- result with ordinary PostgREST modifiers (.order / .range / .eq / .gte).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_scoped_time_punches(
  p_since TIMESTAMPTZ,
  p_office TEXT,
  p_department TEXT,
  p_include_inactive BOOLEAN
)
RETURNS SETOF time_punches
LANGUAGE sql
STABLE
AS $$
  SELECT tp.*
  FROM time_punches tp
  JOIN profiles p ON p.id = tp.profile_id
  WHERE tp.occurred_at >= p_since
    AND (p_include_inactive OR p.is_active = TRUE)
    AND (p_office IS NULL OR p.office = p_office)
    AND (p_department IS NULL OR p.department = p_department);
$$;

CREATE OR REPLACE FUNCTION get_scoped_time_off(
  p_office TEXT,
  p_department TEXT,
  p_include_inactive BOOLEAN
)
RETURNS SETOF time_off_requests
LANGUAGE sql
STABLE
AS $$
  SELECT tr.*
  FROM time_off_requests tr
  JOIN profiles p ON p.id = tr.profile_id
  WHERE (p_include_inactive OR p.is_active = TRUE)
    AND (p_office IS NULL OR p.office = p_office)
    AND (p_department IS NULL OR p.department = p_department);
$$;

REVOKE ALL ON FUNCTION get_launcher_destination_analytics(TEXT, UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_launcher_user_analytics(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_scoped_time_punches(TIMESTAMPTZ, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_scoped_time_off(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION get_launcher_destination_analytics(TEXT, UUID, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_launcher_user_analytics(UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION get_scoped_time_punches(TIMESTAMPTZ, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION get_scoped_time_off(TEXT, TEXT, BOOLEAN) TO service_role;

COMMIT;

-- PostgREST caches the schema; make the new functions callable at once.
NOTIFY pgrst, 'reload schema';
