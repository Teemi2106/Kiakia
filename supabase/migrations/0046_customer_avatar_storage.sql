-- Storage bucket for customer profile pictures. Public bucket: avatars are
-- shown throughout the customer UI (nav, profile card) without requiring
-- the viewer to be authenticated, so reads go through Storage's public URL
-- endpoint (no auth, no RLS check on that path) — same reasoning as
-- 0036_vendor_media_storage.sql.
--
-- No storage.objects RLS policy is added here, deliberately: the only
-- write path is updateAvatarAction (app/actions/profile.ts), which uses
-- the admin/service-role client after verifySession() proves the caller's
-- own identity and scopes the object path to that user's id — same
-- authorization boundary vendor-media uses, not a new idiom.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880, -- 5MiB — matches the app-level check in lib/storage/profile-media.ts
  array['image/png', 'image/jpeg', 'image/webp', 'image/avif']
)
on conflict (id) do nothing;
