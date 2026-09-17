-- Migration 25: Launcher Analytics RPC.
--
-- Replaces the JS-side pagination + aggregation in
-- `src/lib/analytics/server.ts` with a single Postgres call that returns
-- the fully-shaped JSON payload.
--
-- Contract (matches the TypeScript `AnalyticsData`, minus `range`/`since`
-- which the Next.js caller fills in):
--   {
--     totals: {
--       launches, unique_users, unique_destinations,
--       app_launches, link_clicks,
--       top_destination, top_destination_kind, top_destination_launches
--     },
--     apps:  [ { id, name, kind:'app',  launches, unique_users, last_launch } ]  -- launches DESC
--     links: [ { id, name, kind:'link', launches, unique_users, last_launch } ]  -- launches DESC
--     users: [ {
--       user_id, email, name, role, office, launches, last_launch,
--       top_destination, top_destination_kind, top_destination_launches
--     } ]                                                                        -- launches DESC
--     recent: up to 50 { created_at, user_id, email, name, destination, kind }   -- created_at DESC
--   }
--
-- Arguments:
--   p_since             — TIMESTAMPTZ; NULL means "all time".
--   p_allowed_user_ids  — UUID[]; NULL means "no scope filter (admin view)".
--                         Non-NULL restricts the events considered to
--                         user_id IN (allowed).
--
-- Only `event_type IN ('app_launch', 'link_click')` events are considered.
-- Deleted apps/links show as '(deleted app)' / '(deleted link)'; deleted
-- users show email '(unknown user)' with NULL name/office and role
-- 'unknown' (matches the JS default).

CREATE OR REPLACE FUNCTION get_launcher_analytics(
  p_since TIMESTAMPTZ,
  p_allowed_user_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSONB;
BEGIN
  WITH
    -- 1. Filtered raw events. Mirrors the JS pagination query:
    --    event_type IN ('app_launch','link_click')
    --    + optional created_at >= p_since
    --    + optional user_id IN p_allowed_user_ids
    events AS (
      SELECT
        a.user_id,
        a.app_id,
        a.link_id,
        a.event_type,
        a.created_at,
        CASE
          WHEN a.event_type = 'app_launch'  AND a.app_id  IS NOT NULL THEN 'app'
          WHEN a.event_type = 'link_click' AND a.link_id IS NOT NULL THEN 'link'
          ELSE NULL
        END AS kind,
        COALESCE(a.app_id, a.link_id) AS dest_id
      FROM launcher_sso_audit_log a
      WHERE a.event_type IN ('app_launch', 'link_click')
        AND (p_since IS NULL OR a.created_at >= p_since)
        AND (
          p_allowed_user_ids IS NULL
          OR a.user_id = ANY(p_allowed_user_ids)
        )
    ),

    -- Only rows that count as a "launch" (well-formed app/link event with
    -- a target id). Everything below aggregates from this.
    valid_events AS (
      SELECT * FROM events WHERE kind IS NOT NULL
    ),

    -- 2. Per-app aggregate.
    app_agg AS (
      SELECT
        v.app_id AS id,
        COALESCE(la.name, '(deleted app)') AS name,
        COUNT(*)::BIGINT AS launches,
        COUNT(DISTINCT v.user_id)::BIGINT AS unique_users,
        MAX(v.created_at) AS last_launch
      FROM valid_events v
      LEFT JOIN launcher_apps la ON la.id = v.app_id
      WHERE v.kind = 'app'
      GROUP BY v.app_id, la.name
    ),

    -- 3. Per-link aggregate.
    link_agg AS (
      SELECT
        v.link_id AS id,
        COALESCE(ll.name, '(deleted link)') AS name,
        COUNT(*)::BIGINT AS launches,
        COUNT(DISTINCT v.user_id)::BIGINT AS unique_users,
        MAX(v.created_at) AS last_launch
      FROM valid_events v
      LEFT JOIN launcher_links ll ON ll.id = v.link_id
      WHERE v.kind = 'link'
      GROUP BY v.link_id, ll.name
    ),

    -- 4. Per-user, per-destination aggregate — feeds top-destination-per-user.
    --    Key is (kind, dest_id) so top-destination reflects any target
    --    (matches the JS destCounts map keyed by `app:<id>` / `link:<id>`).
    user_dest_agg AS (
      SELECT
        v.user_id,
        v.kind,
        v.dest_id,
        CASE
          WHEN v.kind = 'app'  THEN COALESCE(la.name, '(deleted app)')
          WHEN v.kind = 'link' THEN COALESCE(ll.name, '(deleted link)')
        END AS dest_name,
        COUNT(*)::BIGINT AS dest_count
      FROM valid_events v
      LEFT JOIN launcher_apps  la ON v.kind = 'app'  AND la.id = v.app_id
      LEFT JOIN launcher_links ll ON v.kind = 'link' AND ll.id = v.link_id
      GROUP BY v.user_id, v.kind, v.dest_id, la.name, ll.name
    ),

    -- 5. Per-user top destination. ORDER BY dest_count DESC and pick the
    --    first row per user. Ties break by dest_name then dest_id for
    --    determinism (JS relied on Map insertion order — this is stable
    --    enough for the UI).
    user_top_dest AS (
      SELECT DISTINCT ON (user_id)
        user_id,
        dest_name AS top_destination,
        kind      AS top_destination_kind,
        dest_count AS top_destination_launches
      FROM user_dest_agg
      ORDER BY user_id, dest_count DESC, dest_name ASC, dest_id ASC
    ),

    -- 6. Per-user aggregate.
    user_agg AS (
      SELECT
        v.user_id,
        COALESCE(p.email, '(unknown user)') AS email,
        p.full_name AS name,
        COALESCE(p.role, 'unknown') AS role,
        p.office AS office,
        COUNT(*)::BIGINT AS launches,
        MAX(v.created_at) AS last_launch
      FROM valid_events v
      LEFT JOIN profiles p ON p.id = v.user_id
      GROUP BY v.user_id, p.email, p.full_name, p.role, p.office
    ),

    -- 7. Per-user, merged with top-destination info.
    users_final AS (
      SELECT
        ua.user_id,
        ua.email,
        ua.name,
        ua.role,
        ua.office,
        ua.launches,
        ua.last_launch,
        utd.top_destination,
        utd.top_destination_kind,
        COALESCE(utd.top_destination_launches, 0)::BIGINT AS top_destination_launches
      FROM user_agg ua
      LEFT JOIN user_top_dest utd ON utd.user_id = ua.user_id
    ),

    -- 8. Recent 50 events. Deleted-app/link/user fallbacks match the JS.
    recent_events AS (
      SELECT
        e.created_at,
        e.user_id,
        COALESCE(p.email, '(unknown user)') AS email,
        p.full_name AS name,
        CASE
          WHEN e.event_type = 'link_click'
            THEN COALESCE(ll.name, '(deleted link)')
          ELSE COALESCE(la.name, '(deleted app)')
        END AS destination,
        CASE
          WHEN e.event_type = 'link_click' THEN 'link'
          ELSE 'app'
        END AS kind
      FROM events e
      LEFT JOIN profiles       p  ON p.id  = e.user_id
      LEFT JOIN launcher_apps  la ON la.id = e.app_id
      LEFT JOIN launcher_links ll ON ll.id = e.link_id
      ORDER BY e.created_at DESC
      LIMIT 50
    ),

    -- 9. Totals. Overall top destination is the single highest-launch
    --    entry across apps ∪ links (matches JS which concats both lists
    --    then takes [0]).
    all_dests AS (
      SELECT id, name, 'app'::TEXT AS kind, launches FROM app_agg
      UNION ALL
      SELECT id, name, 'link'::TEXT AS kind, launches FROM link_agg
    ),
    top_dest AS (
      SELECT name, kind, launches
      FROM all_dests
      ORDER BY launches DESC, name ASC, kind ASC
      LIMIT 1
    ),
    totals AS (
      SELECT
        (SELECT COUNT(*)::BIGINT FROM valid_events)                            AS launches,
        (SELECT COUNT(DISTINCT user_id)::BIGINT FROM valid_events)             AS unique_users,
        (SELECT COUNT(*)::BIGINT FROM app_agg)
          + (SELECT COUNT(*)::BIGINT FROM link_agg)                            AS unique_destinations,
        (SELECT COALESCE(SUM(launches), 0)::BIGINT FROM app_agg)               AS app_launches,
        (SELECT COALESCE(SUM(launches), 0)::BIGINT FROM link_agg)              AS link_clicks,
        (SELECT name     FROM top_dest)                                        AS top_destination,
        (SELECT kind     FROM top_dest)                                        AS top_destination_kind,
        COALESCE((SELECT launches FROM top_dest), 0)::BIGINT                   AS top_destination_launches
    )

  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'launches',                  t.launches,
      'unique_users',              t.unique_users,
      'unique_destinations',       t.unique_destinations,
      'app_launches',              t.app_launches,
      'link_clicks',               t.link_clicks,
      'top_destination',           t.top_destination,
      'top_destination_kind',      t.top_destination_kind,
      'top_destination_launches',  t.top_destination_launches
    ),
    'apps', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           id,
          'name',         name,
          'kind',         'app',
          'launches',     launches,
          'unique_users', unique_users,
          'last_launch',  last_launch
        )
        ORDER BY launches DESC, name ASC
      )
      FROM app_agg
    ), '[]'::JSONB),
    'links', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           id,
          'name',         name,
          'kind',         'link',
          'launches',     launches,
          'unique_users', unique_users,
          'last_launch',  last_launch
        )
        ORDER BY launches DESC, name ASC
      )
      FROM link_agg
    ), '[]'::JSONB),
    'users', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'user_id',                   user_id,
          'email',                     email,
          'name',                      name,
          'role',                      role,
          'office',                    office,
          'launches',                  launches,
          'last_launch',               last_launch,
          'top_destination',           top_destination,
          'top_destination_kind',      top_destination_kind,
          'top_destination_launches',  top_destination_launches
        )
        ORDER BY launches DESC, email ASC
      )
      FROM users_final
    ), '[]'::JSONB),
    'recent', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'created_at',  created_at,
          'user_id',     user_id,
          'email',       email,
          'name',        name,
          'destination', destination,
          'kind',        kind
        )
        ORDER BY created_at DESC
      )
      FROM recent_events
    ), '[]'::JSONB)
  )
  INTO result
  FROM totals t;

  RETURN result;
END;
$$;

-- The Next.js admin client authenticates as `service_role`; grant it EXECUTE
-- so `supabase.rpc('get_launcher_analytics', ...)` works from the API route.
GRANT EXECUTE ON FUNCTION get_launcher_analytics(TIMESTAMPTZ, UUID[]) TO service_role;
