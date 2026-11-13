-- Onboarding: requests stay open 30 days (was 7) before the login and
-- documents close. Applies to requests already opened too: each now closes
-- 30 days after it was opened. A password already wiped when its request
-- closed can't come back. Re-runnable.

alter table public.onboarding_requests
  alter column expires_at set default (now() + interval '30 days');

update public.onboarding_requests
set expires_at = created_at + interval '30 days'
where expires_at <> created_at + interval '30 days';
