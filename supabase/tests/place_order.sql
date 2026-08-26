-- pgTAP: place_order() correctness — §"New SQL migrations" in the
-- customer/vendor screens plan. Pricing-scope fix in
-- 0016_fix_place_order_pricing_scope.sql. Same caveat as
-- supabase/tests/rls_orders.sql: not executed here (no Docker/Supabase CLI
-- in this environment), run via `supabase test db` once you have the CLI,
-- or by CI's `pgtap` job.

begin;
select plan(7);

select tests.create_supabase_user('customer_a');
select tests.create_supabase_user('customer_b');
select tests.create_supabase_user('vendor_owner_a');
select tests.create_supabase_user('vendor_owner_b');

-- A service area covering a 1x1-degree square, and a vendor + menu item inside it.
insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, free_above_kobo)
values (
  '00000000-0000-7000-8000-000000000010',
  'Test Area',
  st_geogfromtext('POLYGON((7.0 9.0, 8.0 9.0, 8.0 10.0, 7.0 10.0, 7.0 9.0))'),
  true, 50000, 15000, null
);

insert into vendors (id, owner_user_id, name, slug, status, is_accepting_orders, location, commission_bps, min_order_kobo)
values (
  '00000000-0000-7000-8000-000000000011',
  tests.get_supabase_uid('vendor_owner_a'),
  'Test Vendor', 'test-vendor-place-order', 'active', true,
  st_geogfromtext('POINT(7.5 9.5)'), 1500, 0
);

-- A second, unrelated vendor + item + option — used below to prove an
-- option belonging to a DIFFERENT vendor's menu item can no longer be
-- smuggled into vendor A's order via options_snapshot (the P0 fix).
insert into vendors (id, owner_user_id, name, slug, status, is_accepting_orders, location, commission_bps)
values (
  '00000000-0000-7000-8000-000000000014',
  tests.get_supabase_uid('vendor_owner_b'),
  'Other Vendor', 'test-vendor-place-order-other', 'active', true,
  st_geogfromtext('POINT(7.5 9.5)'), 1500
);

insert into menu_items (id, vendor_id, name, price_kobo, is_available)
values ('00000000-0000-7000-8000-000000000012', '00000000-0000-7000-8000-000000000011', 'Jollof Rice', 250000, true);

insert into menu_items (id, vendor_id, name, price_kobo, is_available)
values ('00000000-0000-7000-8000-000000000015', '00000000-0000-7000-8000-000000000014', 'Other Vendor Item', 100000, true);

insert into option_groups (id, menu_item_id, name)
values ('00000000-0000-7000-8000-000000000016', '00000000-0000-7000-8000-000000000015', 'Other Vendor Options');

insert into options (id, group_id, name, price_delta_kobo)
values ('00000000-0000-7000-8000-000000000017', '00000000-0000-7000-8000-000000000016', 'Extra', 500);

insert into carts (id, customer_id, vendor_id, status)
values ('00000000-0000-7000-8000-000000000013', tests.get_supabase_uid('customer_a'), '00000000-0000-7000-8000-000000000011', 'open');

insert into cart_items (cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, options_snapshot, line_total_kobo)
values ('00000000-0000-7000-8000-000000000013', '00000000-0000-7000-8000-000000000012', 'Jollof Rice', 1, 2, '[]'::jsonb, 2);
-- unit_price_kobo/line_total_kobo here are deliberately wrong (1, not
-- 250000) — the whole point of this test is that place_order() must
-- ignore them and re-derive 250000 from menu_items itself.

-- customer_b cannot place customer_a's cart.
select tests.authenticate_as('customer_b');
select throws_ok(
  $$ select place_order(
       '00000000-0000-7000-8000-000000000013'::uuid,
       '{"line1": "1 Test Street"}'::jsonb,
       st_geogfromtext('POINT(7.5 9.5)'),
       null
     ) $$,
  'a cart cannot be placed by a customer who does not own it'
);

-- customer_a cannot place an order outside every active service area.
select tests.authenticate_as('customer_a');
select throws_ok(
  $$ select place_order(
       '00000000-0000-7000-8000-000000000013'::uuid,
       '{"line1": "1 Test Street"}'::jsonb,
       st_geogfromtext('POINT(50.0 50.0)'), -- nowhere near the test area
       null
     ) $$,
  'an address outside every active service area is rejected'
);

-- An option belonging to a DIFFERENT vendor's menu item, referenced via
-- options_snapshot on an item that legitimately belongs to vendor A, must
-- be rejected outright rather than silently excluded from the price sum
-- (0016_fix_place_order_pricing_scope.sql) — a separate scratch cart, given
-- to customer_b rather than customer_a: `carts_one_open_per_customer`
-- (0004_ordering.sql) is a real unique index, and cart -13 is still 'open'
-- at this point in the file (it isn't converted until the success test
-- below) — a second open cart for customer_a here would violate that
-- constraint. Found by actually executing this file against real Postgres
-- (this environment had no Docker/Supabase CLI when the file was first
-- written, so this was never caught until it was).
select tests.authenticate_as('customer_b');
insert into carts (id, customer_id, vendor_id, status)
values ('00000000-0000-7000-8000-000000000018', tests.get_supabase_uid('customer_b'), '00000000-0000-7000-8000-000000000011', 'open');
insert into cart_items (cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, options_snapshot, line_total_kobo)
values (
  '00000000-0000-7000-8000-000000000018',
  '00000000-0000-7000-8000-000000000012', -- vendor A's own Jollof Rice
  'Jollof Rice', 250000, 1,
  '[{"optionId": "00000000-0000-7000-8000-000000000017"}]'::jsonb, -- option belongs to VENDOR B's item
  250000
);
select throws_ok(
  $$ select place_order(
       '00000000-0000-7000-8000-000000000018'::uuid,
       '{"line1": "1 Test Street"}'::jsonb,
       st_geogfromtext('POINT(7.5 9.5)'),
       null
     ) $$,
  'a cross-vendor option id in options_snapshot is rejected, not silently dropped from the price sum'
);

-- vendors.min_order_kobo is enforced server-side, not just shown in the UI.
select tests.authenticate_as_service_role();
update vendors set min_order_kobo = 999999999 where id = '00000000-0000-7000-8000-000000000011';
select tests.authenticate_as('customer_a');
select throws_ok(
  $$ select place_order(
       '00000000-0000-7000-8000-000000000013'::uuid,
       '{"line1": "1 Test Street"}'::jsonb,
       st_geogfromtext('POINT(7.5 9.5)'),
       null
     ) $$,
  'an order below the vendor''s min_order_kobo is rejected server-side'
);
select tests.authenticate_as_service_role();
update vendors set min_order_kobo = 0 where id = '00000000-0000-7000-8000-000000000011';

-- Found by actually executing this file against real Postgres: nothing
-- re-authenticates as customer_a after the service_role reset above, so the
-- success test below ran as service_role (no jwt 'sub' claim) and place_order()
-- correctly-but-misleadingly rejected it as "cart does not belong to the
-- caller" — the wrong failure for what this assertion means to prove.
select tests.authenticate_as('customer_a');

-- A valid placement re-derives the subtotal from live menu_items pricing
-- (250000 * 2 = 500000), not the cart's fabricated 1-kobo unit price.
select is(
  (select subtotal_kobo from place_order(
     '00000000-0000-7000-8000-000000000013'::uuid,
     '{"line1": "1 Test Street"}'::jsonb,
     st_geogfromtext('POINT(7.5 9.5)'), -- same point as the vendor -> ~0 distance
     null
   )),
  500000::bigint,
  'subtotal is re-derived from live menu_items prices, not the cart snapshot'
);

-- The cart is retired after a successful placement.
select is(
  (select status from carts where id = '00000000-0000-7000-8000-000000000013'),
  'converted',
  'the cart is marked converted after a successful place_order()'
);

-- total_kobo = subtotal + delivery_fee + service_fee exactly (500000 + 50000 + 10000).
select is(
  (select total_kobo from orders where vendor_id = '00000000-0000-7000-8000-000000000011'),
  560000::bigint,
  'total_kobo equals subtotal + delivery_fee + service_fee exactly'
);

select * from finish();
rollback;
