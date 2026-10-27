-- Security scan 2026-10-27: the public anon key could execute these functions.
-- Revoking from PUBLIC is not enough on Supabase: anon and authenticated are
-- granted EXECUTE directly by default privileges. Callers use the service-role
-- key, which keeps access. No app signs in as Supabase's authenticated role.

revoke execute on function public.get_user_role() from public, anon, authenticated;
revoke execute on function public.launcher_builtin_roles() from public, anon, authenticated;
grant execute on function public.get_user_role() to service_role;
grant execute on function public.launcher_builtin_roles() to service_role;
