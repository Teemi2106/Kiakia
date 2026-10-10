-- KiaKia — pgTAP + supabase_test_helpers, required by every file under
-- supabase/tests/ (they call tests.create_supabase_user(),
-- tests.get_supabase_uid(), tests.authenticate_as(),
-- tests.authenticate_as_service_role(), tests.clear_authentication()).
--
-- Committed as a regular migration (not a local-only seed step) on
-- purpose: it keeps the local/CI schema identical to whatever gets
-- deployed. pgtap is inert and ships in Supabase's Postgres image.
--
-- supabase_test_helpers is NOT shipped by every image: the pinned
-- supabase/postgres:17.6.1.147 has pgtap but no supabase_test_helpers control
-- file, so an unconditional CREATE EXTENSION made `supabase start` fail here.
-- It is therefore created only when the server offers it (identical behaviour
-- to before wherever it applied). Where it does not, the same `tests.*`
-- helpers come from supabase/test_helpers_shim.sql, loaded as a LOCAL/CI
-- seed (config.toml [db.seed]) - deliberately NOT a migration, because those
-- helpers create auth.users rows and must never reach a deployed database.
create extension if not exists pgtap with schema extensions;

do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'supabase_test_helpers') then
    create extension if not exists "supabase_test_helpers" with schema extensions;
  else
    raise notice '0013: supabase_test_helpers is not available on this server; pgTAP helpers come from supabase/test_helpers_shim.sql (local seed)';
  end if;
end
$do$;
