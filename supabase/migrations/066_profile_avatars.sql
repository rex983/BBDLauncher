-- Profile photos, shown in every BBD app.
--
-- People upload a photo on their launcher profile (/profile). It's resized
-- in the browser to a 256px square and stored in the public `avatars`
-- bucket at {profile_id}/{uuid}.webp; profiles.avatar_url holds the current
-- one. Apps never read the column directly: they load
-- https://bbd-launcher.vercel.app/api/avatar/<profile_id>, which redirects
-- to the current photo (404 = none, show initials). Kit: launcher-avatar.tsx.
--
-- The bucket is public so an <img> works in any app without a session; the
-- object names are random, and only the launcher's service role writes.
-- Re-runnable.

alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
