-- KiaKia - LOCAL / CI ONLY pgTAP helper shim. Not a migration; never pushed.
--
-- 0013_test_helpers.sql creates the supabase_test_helpers extension only when
-- the server offers it. The pinned supabase/postgres:17.6.1.147 image does not
-- ship it, so without this file every pgTAP suite fails on
-- tests.create_supabase_user(). Loaded after migrations by `supabase start`
-- via config.toml [db.seed] sql_paths. It reproduces the five helpers the
-- suites call, with the same semantics as basejump's supabase_test_helpers,
-- and is a no-op when the real extension (tests.create_supabase_user) exists.
--
-- Kept OUT of migrations on purpose: tests.create_supabase_user() writes
-- auth.users and the helpers are executable by anon/authenticated (the suites
-- switch identity mid-test), which must never exist in a deployed database.
do $shim$
begin
  if to_regproc('tests.create_supabase_user') is not null then
    return;
  end if;
  execute $sql$
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

create or replace function tests.create_supabase_user(identifier text, email text default null, phone text default null, metadata jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = auth, pg_temp
as $$
declare
  user_id uuid;
begin
  user_id := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, phone, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', user_id, 'authenticated', 'authenticated',
          coalesce(email, identifier || '@example.com'), phone,
          jsonb_build_object('test_identifier', identifier) || coalesce(metadata, '{}'::jsonb),
          '{}'::jsonb, now(), now());
  return user_id;
end;
$$;

create or replace function tests.get_supabase_uid(identifier text)
returns uuid
language plpgsql
security definer
set search_path = auth, pg_temp
as $$
declare
  supabase_user uuid;
begin
  select id into supabase_user from auth.users where raw_user_meta_data ->> 'test_identifier' = identifier limit 1;
  if supabase_user is null then
    raise exception 'supabase_test_helpers user identifier "%" could not be found', identifier;
  end if;
  return supabase_user;
end;
$$;

create or replace function tests.authenticate_as(identifier text)
returns void
language plpgsql
as $$
begin
  -- get_supabase_uid() is SECURITY DEFINER (reads auth.users) and raises when
  -- the identifier is unknown, so this works from any current role.
  perform tests.get_supabase_uid(identifier);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', tests.get_supabase_uid(identifier)::text,
    'role', 'authenticated',
    'email', identifier || '@example.com')::text, true);
  perform set_config('request.jwt.claim.sub', tests.get_supabase_uid(identifier)::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

create or replace function tests.authenticate_as_service_role()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
end;
$$;

create or replace function tests.clear_authentication()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', null, true);
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('request.jwt.claim.role', null, true);
end;
$$;

grant usage on schema tests to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;
  $sql$;
end
$shim$;
