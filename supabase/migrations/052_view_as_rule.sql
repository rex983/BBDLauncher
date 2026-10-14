-- Migration 52: who may "View as" whom — one rule for the launcher and every app.
-- Idempotent. Apply in the Supabase SQL Editor for xockuiyvxijuzlwlsfbu.
--
--   * Admins (role = 'admin') may view as any other active person.
--   * Managers (permission role senior_manager / junior_manager, i.e. the role
--     or its "Permissions like") may view as active people below them: not
--     admins and not managers, in their own office. A BST manager covers
--     every office (same rule as management analytics); a manager with no
--     office covers no one.
--   * Nobody else may.
--
-- launcher_can_view_as(viewer, target)  → boolean
-- launcher_view_as_targets(viewer)      → setof uuid (for pickers)
-- Service-role only. The launcher's View as picker and launch route, the
-- launcher kit's actor check in every app, and the hub / MQ / QSB in-app
-- previews all ask these.

CREATE OR REPLACE FUNCTION public.launcher_view_as_targets(p_viewer uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH viewer AS (
    SELECT p.id, p.role, p.office,
           COALESCE(r.acts_as, p.role) AS perm
    FROM profiles p
    LEFT JOIN launcher_roles r ON r.name = p.role
    WHERE p.id = p_viewer AND COALESCE(p.is_active, true)
  )
  SELECT t.id
  FROM viewer v
  JOIN profiles t ON t.id <> v.id AND COALESCE(t.is_active, true)
  LEFT JOIN launcher_roles tr ON tr.name = t.role
  WHERE v.role = 'admin'
     OR (
          v.perm IN ('senior_manager', 'junior_manager')
          AND t.role <> 'admin'
          AND COALESCE(tr.acts_as, t.role) NOT IN ('admin', 'senior_manager', 'junior_manager')
          AND v.office IS NOT NULL
          AND (v.office = 'BST' OR t.office = v.office)
        );
$$;

CREATE OR REPLACE FUNCTION public.launcher_can_view_as(p_viewer uuid, p_target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM launcher_view_as_targets(p_viewer) t WHERE t = p_target);
$$;

REVOKE ALL ON FUNCTION public.launcher_view_as_targets(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.launcher_can_view_as(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.launcher_view_as_targets(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.launcher_can_view_as(uuid, uuid) TO service_role;
