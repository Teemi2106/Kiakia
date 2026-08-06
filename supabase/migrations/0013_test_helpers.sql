-- KiaKia — pgTAP + supabase_test_helpers, required by every file under
-- supabase/tests/ (they call tests.create_supabase_user(),
-- tests.get_supabase_uid(), tests.authenticate_as(),
-- tests.authenticate_as_service_role(), tests.clear_authentication()).
--
-- Committed as a regular migration (not a local-only seed step) on
-- purpose: it keeps the local/CI schema identical to whatever gets
-- deployed, the same "don't let test and prod schemas drift" reasoning
-- already applied elsewhere in this migration set. Both extensions are
-- inert — a `tests` schema of assertion helpers, no runtime behavior
-- change for the app itself — and ship pre-installed in Supabase's
-- Postgres image, so this needs no network access to apply.
create extension if not exists pgtap with schema extensions;
create extension if not exists "supabase_test_helpers" with schema extensions;
