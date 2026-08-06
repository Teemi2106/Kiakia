-- pgTAP: place_order() correctness — §"New SQL migrations" in the
-- customer/vendor screens plan. Same caveat as supabase/tests/rls_orders.sql:
-- not executed here (no Docker/Supabase CLI in this environment), run via
-- `supabase test db` once you have the CLI, or by CI's `pgtap` job.

begin;
select plan(5);

select tests.create_supabase_user('customer_a');
select tests.create_supabase_user('customer_b');
select tests.create_supabase_user('vendor_owner_a');

-- A service area covering a 1x1-degree square, and a vendor + menu item inside it.
insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, free_above_kobo)
values (
  '00000000-0000-7000-8000-000000000010',
  'Test Area',
  st_geogfromtext('POLYGON((7.0 9.0, 8.0 9.0, 8.0 10.0, 7.0 10.0, 7.0 9.0))'),
  true, 50000, 15000, null
);

insert into vendors (id, owner_user_id, name, slug, status, is_accepting_orders, location, commission_bps)
values (
  '00000000-0000-7000-8000-000000000011',
  tests.get_supabase_uid('vendor_owner_a'),
  'Test Vendor', 'test-vendor-place-order', 'active', true,
  st_geogfromtext('POINT(7.5 9.5)'), 1500
);

insert into menu_items (id, vendor_id, name, price_kobo, is_available)
values ('00000000-0000-7000-8000-000000000012', '00000000-0000-7000-8000-000000000011', 'Jollof Rice', 250000, true);

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
