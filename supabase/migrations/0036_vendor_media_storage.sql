-- Storage bucket for vendor-uploaded images (menu item photos, store
-- banner) — replaces the plain "paste a URL" text fields with real file
-- uploads. Public bucket: images are shown to anyone browsing the
-- customer-facing storefront/menu, unauthenticated, so reads go through
-- Storage's public URL endpoint (no auth, no RLS check on that path).
--
-- No storage.objects RLS policy is added here, deliberately: every upload
-- goes through a Server Action using the admin/service-role client after
-- that action's own vendor_staff membership check (assertVendorStaff() in
-- app/actions/menu.ts, the equivalent check in app/actions/vendor.ts) —
-- same authorization boundary every other vendor-owned write in this
-- codebase already uses (menu items, vendor settings), not a new idiom.
-- service_role already bypasses RLS outright, so a client-side upload
-- path was never the intent here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vendor-media',
  'vendor-media',
  true,
  5242880, -- 5MiB — matches the app-level check in lib/storage/vendor-media.ts
  array['image/png', 'image/jpeg', 'image/webp', 'image/avif']
)
on conflict (id) do nothing;
