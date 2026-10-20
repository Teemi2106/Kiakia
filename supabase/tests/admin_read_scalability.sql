-- pgTAP: admin_list_users and the index changes of 0087_admin_read_scalability.sql.
--
-- What this protects, in order of how bad getting it wrong would be:
-- (1) NO ROLE BUT service_role CAN CALL admin_list_users - it returns every
--     profile's phone number, and PostgREST exposes anything granted to
--     authenticated, so a browser holding a user JWT (even an admin's) must be
--     refused.
-- (2) The search term is a LITERAL. A '%', '_' or '\' typed into the admin
--     search box must match only names/phones that really contain it, never
--     everything (and a trailing backslash must not be an ILIKE syntax error).
-- (3) Filters/pagination: status and role narrow correctly, roles are the
--     distinct sorted set per user, total_count is the full match count on
--     every row regardless of limit/offset, bad input is a check_violation.
-- (4) The indexes the admin read paths rely on exist (and the superseded
--     single-column order_ratings ones are gone).
--
-- Every assertion is scoped to fixture rows through the distinctive token
-- 'Zqx', so rows already in the database cannot change a count.

begin;
select plan(37);

select tests.create_supabase_user('rs_u1');
select tests.create_supabase_user('rs_u2');
select tests.create_supabase_user('rs_u3');
select tests.create_supabase_user('rs_u4');
select tests.create_supabase_user('rs_u5');
select tests.create_supabase_user('rs_admin');

-- created_at is fixed so the newest-first order is deterministic (every row
-- would otherwise share this transaction's now()). Newest is u5.
update profiles set full_name = 'Zqx Alpha',     phone = '+2349000000001', created_at = '2030-01-01' where id = tests.get_supabase_uid('rs_u1');
update profiles set full_name = 'Zqx_Beta',      phone = '+2349000000002', created_at = '2030-01-02' where id = tests.get_supabase_uid('rs_u2');
update profiles set full_name = 'Zqx 50% Gamma', phone = '+2349000000003', created_at = '2030-01-03', status = 'suspended' where id = tests.get_supabase_uid('rs_u3');
update profiles set full_name = 'ZqxXDelta',     phone = '+2349000000004', created_at = '2030-01-04' where id = tests.get_supabase_uid('rs_u4');
update profiles set full_name = 'Zqx\Eps',       phone = '+2349000000005', created_at = '2030-01-05' where id = tests.get_supabase_uid('rs_u5');

-- Every new user already holds 'customer'. u1: rider plus vendor_staff at TWO
-- vendors (must aggregate to one 'vendor_staff'); u3: admin.
insert into user_roles (user_id, role, scope_type, scope_id) values
  (tests.get_supabase_uid('rs_u1'), 'rider', 'platform', null),
  (tests.get_supabase_uid('rs_u1'), 'vendor_staff', 'vendor', gen_random_uuid()),
  (tests.get_supabase_uid('rs_u1'), 'vendor_staff', 'vendor', gen_random_uuid()),
  (tests.get_supabase_uid('rs_u3'), 'admin', 'platform', null),
  (tests.get_supabase_uid('rs_admin'), 'admin', 'platform', null);

-- ---------------------------------------------------------------------------
-- (1) Who may call it.
-- ---------------------------------------------------------------------------

select tests.clear_authentication();
select throws_ok($$ select * from admin_list_users('Zqx') $$, '42501', null, 'anon cannot call admin_list_users');

select tests.authenticate_as('rs_u1');
select throws_ok($$ select * from admin_list_users('Zqx') $$, '42501', null, 'a plain authenticated user cannot call admin_list_users');

select tests.authenticate_as('rs_admin');
select throws_ok($$ select * from admin_list_users('Zqx') $$, '42501', null, 'an authenticated admin (user JWT) cannot call admin_list_users - service_role only');

select tests.authenticate_as_service_role();
select ok(
  has_function_privilege('service_role', 'admin_list_users(text, text, text, integer, integer)', 'execute'),
  'service_role can execute admin_list_users'
);

-- ---------------------------------------------------------------------------
-- (3a) Input validation.
-- ---------------------------------------------------------------------------

select throws_ok($$ select * from admin_list_users(null, null, null, 0, 0) $$, '23514', null, 'limit 0 is refused');
select throws_ok($$ select * from admin_list_users(null, null, null, 201, 0) $$, '23514', null, 'limit above 200 is refused');
select throws_ok($$ select * from admin_list_users(null, null, null, 10, -1) $$, '23514', null, 'a negative offset is refused');
select throws_ok($$ select * from admin_list_users(null, 'banned') $$, '23514', null, 'an unknown status is refused');
select throws_ok($$ select * from admin_list_users(null, null, 'customer') $$, '23514', null, 'a role outside the allowed filter set (customer) is refused');
select throws_ok($$ select * from admin_list_users(repeat('a', 101)) $$, '23514', null, 'a search term over 100 characters is refused');

-- ---------------------------------------------------------------------------
-- (3b) Results, order, pagination, total_count.
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from admin_list_users('Zqx', null, null, 50, 0)),
  5, 'search Zqx matches the 5 fixture users'
);
select is(
  (select array_agg(full_name) from admin_list_users('Zqx', null, null, 50, 0)),
  array['Zqx\Eps', 'ZqxXDelta', 'Zqx 50% Gamma', 'Zqx_Beta', 'Zqx Alpha']::text[],
  'rows come back newest first'
);
select is(
  (select array_agg(full_name) from admin_list_users('Zqx', null, null, 2, 1)),
  array['ZqxXDelta', 'Zqx 50% Gamma']::text[],
  'limit 2 offset 1 returns the second and third newest'
);
select is(
  (select array_agg(distinct total_count) from admin_list_users('Zqx', null, null, 2, 1)),
  array[5::bigint], 'total_count is the full match count (5) on every row of a 2-row page'
);
select is(
  (select count(*)::int from admin_list_users('Zqx', null, null, 50, 100)),
  0, 'an offset past the end returns no rows'
);

-- Status filter.
select is(
  (select array_agg(full_name) from admin_list_users('Zqx', 'suspended', null, 50, 0)),
  array['Zqx 50% Gamma']::text[], 'status filter: suspended returns only the suspended user'
);
select is(
  (select count(*)::int from admin_list_users('Zqx', 'active', null, 50, 0)),
  4, 'status filter: active returns the other four'
);

-- Role filter (EXISTS on user_roles) and roles aggregation.
select is(
  (select array_agg(full_name) from admin_list_users('Zqx', null, 'rider', 50, 0)),
  array['Zqx Alpha']::text[], 'role filter: rider returns only the rider'
);
select is(
  (select array_agg(full_name) from admin_list_users('Zqx', null, 'admin', 50, 0)),
  array['Zqx 50% Gamma']::text[], 'role filter: admin returns only the admin'
);
select is(
  (select roles from admin_list_users('Zqx Alpha', null, null, 5, 0)),
  array['customer', 'rider', 'vendor_staff']::text[], 'roles are distinct and sorted (vendor_staff held at two vendors appears once)'
);
select is(
  (select roles from admin_list_users('Gamma', null, null, 5, 0)),
  array['admin', 'customer']::text[], 'roles aggregate the admin role beside the default customer role'
);
select is(
  (select roles from admin_list_users('ZqxXDelta', null, null, 5, 0)),
  array['customer']::text[], 'a user with only the default role has just customer'
);

-- ---------------------------------------------------------------------------
-- (2) Literal search.
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(full_name) from admin_list_users('Zqx_', null, null, 50, 0)),
  array['Zqx_Beta']::text[], 'an underscore is literal: Zqx_ does not match "Zqx " / "ZqxX"'
);
select is(
  (select array_agg(full_name) from admin_list_users('50%', null, null, 50, 0)),
  array['Zqx 50% Gamma']::text[], 'a percent sign is literal'
);
select is(
  (select count(*)::int from admin_list_users('Zqx%G', null, null, 50, 0)),
  0, 'Zqx%G matches nothing: % is not a wildcard'
);
select is(
  (select count(*)::int from admin_list_users('%', null, null, 200, 0)
   where position('%' in coalesce(full_name, '') || coalesce(phone, '')) = 0),
  0, 'searching "%" returns only rows that really contain a percent sign'
);
select ok(
  (select count(*) from admin_list_users('%', null, null, 200, 0)) >= 1,
  'searching "%" still finds the row that does contain one'
);
select is(
  (select array_agg(full_name) from admin_list_users('x\', null, null, 50, 0)),
  array['Zqx\Eps']::text[], 'a backslash is literal (and a trailing one is not an ILIKE error)'
);
select is(
  (select array_agg(full_name) from admin_list_users('zQX aLPHA', null, null, 50, 0)),
  array['Zqx Alpha']::text[], 'search is case-insensitive'
);
select is(
  (select array_agg(full_name) from admin_list_users('9000000002', null, null, 50, 0)),
  array['Zqx_Beta']::text[], 'search also matches the phone number'
);
select ok(
  (select count(*) from admin_list_users('   ', null, null, 200, 0)) >= 5,
  'a blank search term is no filter'
);

-- ---------------------------------------------------------------------------
-- (4) Indexes.
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and indexname in ('order_ratings_vendor_created_idx', 'order_ratings_rider_created_idx')),
  2, 'composite (id, created_at desc) order_ratings indexes exist'
);
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and indexname in ('order_ratings_vendor_id_idx', 'order_ratings_rider_id_idx')),
  0, 'the superseded single-column order_ratings indexes are gone'
);
select is(
  (select indexdef ~ 'vendor_id, created_at DESC' from pg_indexes where indexname = 'order_ratings_vendor_created_idx'),
  true, 'the vendor ratings index orders created_at descending'
);
select is(
  (select indexdef ~ 'WHERE \(rider_id IS NOT NULL\)' from pg_indexes where indexname = 'order_ratings_rider_created_idx'),
  true, 'the rider ratings index is partial on rider_id is not null'
);
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public'
     and indexname in ('orders_code_trgm_idx', 'profiles_full_name_trgm_idx', 'profiles_phone_trgm_idx', 'vendors_name_trgm_idx')
     and indexdef ~ 'USING gin'),
  4, 'trigram GIN indexes exist for orders.code, profiles.full_name, profiles.phone, vendors.name'
);
select is(
  (select count(*)::int from pg_indexes where schemaname = 'public' and indexname = 'user_roles_role_user_idx'),
  1, 'user_roles has a role-leading index for the role filter'
);

select * from finish();
rollback;
