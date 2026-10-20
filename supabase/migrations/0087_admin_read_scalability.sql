-- KiaKia - admin read-path scalability.
--
-- Three things the admin read layer (apps/web/src/lib/admin) does today that
-- stop working, or get slow, once the tables hold real data:
--
--   1. listUsers' role filter loaded EVERY user_id holding the role and sent
--      them back to PostgREST as `.in("id", [...])`. A few hundred holders
--      overflow the request URL, and it costs a second round trip for the
--      roles of the page. admin_list_users() does the filter, the search, the
--      role aggregation and the total in one query.
--   2. The admin substring searches (`ilike '%term%'`) on orders.code,
--      profiles.full_name, profiles.phone and vendors.name cannot use a btree
--      index, so every keystroke-search is a sequential scan. Trigram GIN
--      indexes serve ILIKE '%term%' directly. Only the columns lib/admin
--      actually searches are indexed.
--   3. "Newest N ratings for a vendor / rider" (the admin detail pages) was
--      served by a single-column index plus a sort. Composite (id, created_at
--      desc) indexes make it a plain index scan.
--
-- Deploy: lock_timeout makes a blocked CREATE INDEX fail fast instead of queueing
-- writers behind it. On a populated production DB, pre-build the indexes by hand
-- (outside a transaction, so CONCURRENTLY works); the statements below are then
-- no-ops:
--   create extension if not exists pg_trgm with schema extensions;
--   create index concurrently if not exists orders_code_trgm_idx on orders using gin (code extensions.gin_trgm_ops);
--   create index concurrently if not exists profiles_full_name_trgm_idx on profiles using gin (full_name extensions.gin_trgm_ops);
--   create index concurrently if not exists profiles_phone_trgm_idx on profiles using gin (phone extensions.gin_trgm_ops);
--   create index concurrently if not exists vendors_name_trgm_idx on vendors using gin (name extensions.gin_trgm_ops);
--   create index concurrently if not exists user_roles_role_user_idx on user_roles (role, user_id);
--   create index concurrently if not exists order_ratings_vendor_created_idx on order_ratings (vendor_id, created_at desc);
--   create index concurrently if not exists order_ratings_rider_created_idx on order_ratings (rider_id, created_at desc) where rider_id is not null;
--
-- user_roles is already covered for the per-user direction by
-- user_roles_user_id_idx and the unique indexes of 0014 (all lead with
-- user_id). The role filter's other direction (who holds role X) leads with
-- role, which nothing serves, hence user_roles_role_user_idx.

set local lock_timeout = '5s';

-- pg_trgm goes in the `extensions` schema like pgcrypto/pgtap on Supabase
-- (0013; see 0016 for why that schema is not on every search_path), so the
-- opclass is schema-qualified below.
create extension if not exists pg_trgm with schema extensions;

create index if not exists orders_code_trgm_idx on orders using gin (code extensions.gin_trgm_ops);
create index if not exists profiles_full_name_trgm_idx on profiles using gin (full_name extensions.gin_trgm_ops);
create index if not exists profiles_phone_trgm_idx on profiles using gin (phone extensions.gin_trgm_ops);
create index if not exists vendors_name_trgm_idx on vendors using gin (name extensions.gin_trgm_ops);

create index if not exists user_roles_role_user_idx on user_roles (role, user_id);

-- Nothing else references the two 0073 index names (grepped migrations, tests
-- and apps/ before dropping).
drop index if exists order_ratings_vendor_id_idx;
drop index if exists order_ratings_rider_id_idx;
create index if not exists order_ratings_vendor_created_idx on order_ratings (vendor_id, created_at desc);
create index if not exists order_ratings_rider_created_idx on order_ratings (rider_id, created_at desc) where rider_id is not null;

-- ---------------------------------------------------------------------------
-- admin_list_users - the users page.
--
-- p_q is matched as a LITERAL case-insensitive substring of full_name or
-- phone: backslash, % and _ are escaped before the ILIKE pattern is built, so
-- a search for '%' or '_' matches only names/phones that really contain one
-- (it does not match everything). No dynamic SQL. The escaped pattern keeps the
-- ILIKE, which is what the trigram indexes above serve.
-- p_status / p_role are validated against the same sets as the zod enums in
-- lib/admin/users.ts (not 'customer' for role: every account holds it).
-- roles is every distinct role the user holds, sorted, so the page needs no
-- second query; total_count repeats on every row (as in admin_list_balances).
-- ---------------------------------------------------------------------------

create function admin_list_users(
  p_q       text default null,
  p_status  text default null,
  p_role    text default null,
  p_limit   integer default 25,
  p_offset  integer default 0
)
returns table (
  id          uuid,
  full_name   text,
  phone       text,
  status      text,
  created_at  timestamptz,
  roles       text[],
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
-- p_q/p_status/p_role are nullable "(p is null or col = p)" filters; a cached
-- generic plan cannot know which are null, so plan per call to get the trigram
-- indexes.
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
declare
  v_pattern text;
begin
  if p_limit is null or p_limit not between 1 and 200 or p_offset is null or p_offset < 0 then
    raise exception 'admin_list_users: limit must be 1-200 and offset non-negative'
      using errcode = 'check_violation';
  end if;
  if p_status is not null and p_status not in ('active', 'suspended', 'deleted') then
    raise exception 'admin_list_users: status must be active, suspended or deleted, got %', p_status
      using errcode = 'check_violation';
  end if;
  if p_role is not null and p_role not in ('rider', 'vendor_staff', 'vendor_manager', 'vendor_owner', 'admin', 'superadmin') then
    raise exception 'admin_list_users: unsupported role filter %', p_role
      using errcode = 'check_violation';
  end if;
  if p_q is not null and char_length(p_q) > 100 then
    raise exception 'admin_list_users: search term must be at most 100 characters'
      using errcode = 'check_violation';
  end if;

  -- Blank/whitespace-only search is no search.
  if p_q is not null and btrim(p_q) <> '' then
    v_pattern := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select p.id,
         p.full_name,
         p.phone,
         p.status,
         p.created_at,
         coalesce((select array_agg(distinct ur.role order by ur.role) from user_roles ur where ur.user_id = p.id), '{}'::text[]),
         count(*) over ()
  from profiles p
  where (v_pattern is null or p.full_name ilike v_pattern or p.phone ilike v_pattern)
    and (p_status is null or p.status = p_status)
    and (p_role is null or exists (select 1 from user_roles r where r.user_id = p.id and r.role = p_role))
  order by p.created_at desc, p.id desc
  limit p_limit offset p_offset;
end;
$$;

comment on function admin_list_users(text, text, text, integer, integer) is
  'Paginated user list for the admin users page: literal case-insensitive substring search on full_name/phone, optional status and role filters (validated), distinct sorted roles aggregated per user, total_count on every row. Newest first. service_role only.';

revoke execute on function admin_list_users(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function admin_list_users(text, text, text, integer, integer) to service_role;
