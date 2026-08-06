-- pgTAP: proves the cross-tenant read boundary on `orders` from
-- 0007_rls.sql, per §5 ("Test your policies... A wrong policy is a data
-- breach, and it fails silently") and §19's testing table.
--
-- NOT executed as part of this foundation — there is no Docker/Supabase
-- CLI available in the environment this was authored in. Run it with:
--   supabase start
--   supabase test db
-- once you have the CLI + Docker installed locally, or wire it into CI
-- against a `supabase start`-backed Postgres service container.

begin;
select plan(4);

-- Two customers, one vendor with staff, one order belonging to customer_a.
select tests.create_supabase_user('customer_a');
select tests.create_supabase_user('customer_b');
select tests.create_supabase_user('vendor_owner_a');

insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values ('00000000-0000-7000-8000-000000000001', tests.get_supabase_uid('vendor_owner_a'), 'Test Vendor', 'test-vendor', 'active', 1500);

insert into vendor_staff (vendor_id, user_id, role)
values ('00000000-0000-7000-8000-000000000001', tests.get_supabase_uid('vendor_owner_a'), 'vendor_owner');

insert into orders (id, customer_id, vendor_id, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000002',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000001',
  1000000, 200000, 50000, 0, 1250000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);

-- customer_a can read their own order.
select tests.authenticate_as('customer_a');
select is(
  (select count(*)::int from orders where id = '00000000-0000-7000-8000-000000000002'),
  1,
  'customer_a can read their own order'
);

-- customer_b cannot read customer_a's order.
select tests.authenticate_as('customer_b');
select is(
  (select count(*)::int from orders where id = '00000000-0000-7000-8000-000000000002'),
  0,
  'customer_b cannot read customer_a''s order'
);

-- vendor staff on the order's vendor can read it.
select tests.authenticate_as('vendor_owner_a');
select is(
  (select count(*)::int from orders where id = '00000000-0000-7000-8000-000000000002'),
  1,
  'vendor staff on the order''s vendor can read it'
);

-- No authenticated role can write orders.status directly — only
-- transition_order() may. This must fail (insufficient privilege).
select tests.authenticate_as('customer_a');
select throws_ok(
  $$ update orders set status = 'accepted' where id = '00000000-0000-7000-8000-000000000002' $$,
  '42501', -- insufficient_privilege
  null,
  'direct UPDATE of orders.status is rejected — writes are revoked from authenticated (§10)'
);

select * from finish();
rollback;
