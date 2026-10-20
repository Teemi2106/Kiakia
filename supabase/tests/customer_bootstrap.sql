-- pgTAP: customer_bootstrap() and the RLS initplan rewrite (0089).
--
-- (1) customer_bootstrap() returns the caller's own open cart + items (with
--     the menu item image and vendor name), unread notification count and
--     default address, and nothing of anyone else's; an empty cart is null;
--     anon is denied.
-- (2) Regression guard for the (select auth.uid()) rewrite: another customer
--     still cannot read or write carts, cart_items, notifications, addresses
--     or orders.

begin;
select plan(23);

select tests.create_supabase_user('cb_a');
select tests.create_supabase_user('cb_b');
select tests.create_supabase_user('cb_c');
select tests.create_supabase_user('cb_vendor');

insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values ('00000000-0000-7000-8000-0000000b0001', tests.get_supabase_uid('cb_vendor'), 'Bootstrap Kitchen', 'cb-kitchen', 'active', 1500);

insert into menu_items (id, vendor_id, name, image_url, price_kobo) values
  ('00000000-0000-7000-8000-0000000b0011', '00000000-0000-7000-8000-0000000b0001', 'Jollof', 'https://img.test/jollof.png', 150000),
  ('00000000-0000-7000-8000-0000000b0012', '00000000-0000-7000-8000-0000000b0001', 'Plain rice', null, 100000);

-- cb_a: open cart with two items, a closed cart, 2 unread + 1 read notification,
-- a non-default and a default address. cb_b: its own cart/notification/address.
insert into carts (id, customer_id, vendor_id, status) values
  ('00000000-0000-7000-8000-0000000b0021', tests.get_supabase_uid('cb_a'), '00000000-0000-7000-8000-0000000b0001', 'open'),
  ('00000000-0000-7000-8000-0000000b0022', tests.get_supabase_uid('cb_a'), '00000000-0000-7000-8000-0000000b0001', 'converted'),
  ('00000000-0000-7000-8000-0000000b0023', tests.get_supabase_uid('cb_b'), '00000000-0000-7000-8000-0000000b0001', 'open');

insert into cart_items (id, cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, options_snapshot, line_total_kobo) values
  ('00000000-0000-7000-8000-0000000b0031', '00000000-0000-7000-8000-0000000b0021', '00000000-0000-7000-8000-0000000b0011', 'Jollof', 150000, 2, '[{"name":"Extra"}]', 300000),
  ('00000000-0000-7000-8000-0000000b0032', '00000000-0000-7000-8000-0000000b0021', '00000000-0000-7000-8000-0000000b0012', 'Plain rice', 100000, 1, '[]', 100000),
  ('00000000-0000-7000-8000-0000000b0033', '00000000-0000-7000-8000-0000000b0022', '00000000-0000-7000-8000-0000000b0011', 'Jollof', 150000, 9, '[]', 1350000),
  ('00000000-0000-7000-8000-0000000b0034', '00000000-0000-7000-8000-0000000b0023', '00000000-0000-7000-8000-0000000b0011', 'Jollof', 150000, 5, '[]', 750000);

insert into notifications (customer_id, title, body, is_read) values
  (tests.get_supabase_uid('cb_a'), 'n1', 'b', false),
  (tests.get_supabase_uid('cb_a'), 'n2', 'b', false),
  (tests.get_supabase_uid('cb_a'), 'n3', 'b', true),
  (tests.get_supabase_uid('cb_b'), 'other', 'b', false),
  (tests.get_supabase_uid('cb_b'), 'other2', 'b', false),
  (tests.get_supabase_uid('cb_b'), 'other3', 'b', false);

insert into addresses (id, customer_id, label, line1, is_default, location) values
  ('00000000-0000-7000-8000-0000000b0041', tests.get_supabase_uid('cb_a'), 'Work', '2 Work Rd', false, st_geogfromtext('POINT(7.45 9.05)')),
  ('00000000-0000-7000-8000-0000000b0042', tests.get_supabase_uid('cb_a'), 'Home', '1 Home St', true, st_geogfromtext('POINT(7.45 9.05)')),
  ('00000000-0000-7000-8000-0000000b0043', tests.get_supabase_uid('cb_b'), 'B home', '9 Other St', true, st_geogfromtext('POINT(7.45 9.05)'));

insert into orders (id, customer_id, vendor_id, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values ('00000000-0000-7000-8000-0000000b0051', tests.get_supabase_uid('cb_a'), '00000000-0000-7000-8000-0000000b0001',
        1000000, 0, 0, 0, 1000000, '{"line1": "1 Home St"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'));

-- ---------------------------------------------------------------------------
-- customer_bootstrap() as cb_a.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('cb_a');
create temp table cb_res on commit drop as select customer_bootstrap() as r;
grant select on cb_res to authenticated, anon;

select is((select r #>> '{cart,id}' from cb_res), '00000000-0000-7000-8000-0000000b0021', 'returns the caller''s open cart (not the closed one)');
select is((select r #>> '{cart,vendor_name}' from cb_res), 'Bootstrap Kitchen', 'cart carries the vendor name');
select is((select jsonb_array_length(r #> '{cart,items}') from cb_res), 2, 'cart has exactly the caller''s two items (not the closed cart''s or cb_b''s)');
select is((select r #>> '{cart,items,0,id}' from cb_res), '00000000-0000-7000-8000-0000000b0031', 'items are ordered by creation (uuidv7 id)');
select is((select r #>> '{cart,items,0,menu_item_image_url}' from cb_res), 'https://img.test/jollof.png', 'item image comes from menu_items.image_url');
select ok((select r #> '{cart,items,1,menu_item_image_url}' from cb_res) = 'null'::jsonb, 'item without an image yields null');
select is(
  (select (r #> '{cart,items,0}') - 'menu_item_image_url'::text from cb_res),
  '{"id":"00000000-0000-7000-8000-0000000b0031","menu_item_id":"00000000-0000-7000-8000-0000000b0011","name_snapshot":"Jollof","unit_price_kobo":150000,"qty":2,"options_snapshot":[{"name":"Extra"}],"line_total_kobo":300000}'::jsonb,
  'item fields are exactly the documented shape'
);
select is((select (r ->> 'unread_notifications')::int from cb_res), 2, 'unread count is the caller''s own unread only');
select is((select r #>> '{default_address,label}' from cb_res), 'Home', 'default address label is the is_default row');
select is((select r #>> '{default_address,line1}' from cb_res), '1 Home St', 'default address line1');
select is((select count(*)::int from jsonb_object_keys((select r from cb_res))), 3, 'top-level keys are cart, unread_notifications, default_address');

-- ---------------------------------------------------------------------------
-- cb_b sees only its own; cb_c (nothing) gets null / 0 / null.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('cb_b');
select is((customer_bootstrap() #>> '{cart,id}'), '00000000-0000-7000-8000-0000000b0023', 'cb_b gets cb_b''s cart, never cb_a''s');
select is((customer_bootstrap() ->> 'unread_notifications')::int, 3, 'cb_b unread count is cb_b''s');

select tests.authenticate_as('cb_c');
select ok((customer_bootstrap() -> 'cart') = 'null'::jsonb, 'no open cart -> cart is null');
select is((customer_bootstrap() ->> 'unread_notifications')::int, 0, 'no notifications -> 0');
select ok((customer_bootstrap() -> 'default_address') = 'null'::jsonb, 'no address -> default_address is null');

-- A cart with zero items is still a cart, with an empty items array.
reset role;
insert into carts (id, customer_id, status) values ('00000000-0000-7000-8000-0000000b0024', tests.get_supabase_uid('cb_c'), 'open');
select tests.authenticate_as('cb_c');
select is((customer_bootstrap() #> '{cart,items}'), '[]'::jsonb, 'empty open cart -> items is []');

-- ---------------------------------------------------------------------------
-- anon denied.
-- ---------------------------------------------------------------------------

select tests.clear_authentication();
select throws_ok($$ select customer_bootstrap() $$, '42501', null, 'anon cannot execute customer_bootstrap()');

-- ---------------------------------------------------------------------------
-- Cross-user RLS regression guard (cb_c vs cb_a's rows).
-- ---------------------------------------------------------------------------

select tests.authenticate_as('cb_c');
select is((select count(*)::int from carts where id = '00000000-0000-7000-8000-0000000b0021'), 0, 'cb_c cannot read cb_a''s cart');
select is((select count(*)::int from cart_items where cart_id = '00000000-0000-7000-8000-0000000b0021'), 0, 'cb_c cannot read cb_a''s cart_items');
select is((select count(*)::int from notifications where customer_id = tests.get_supabase_uid('cb_a')), 0, 'cb_c cannot read cb_a''s notifications');
select is(
  (select count(*)::int from addresses where customer_id = tests.get_supabase_uid('cb_a'))
  + (select count(*)::int from orders where customer_id = tests.get_supabase_uid('cb_a')),
  0,
  'cb_c cannot read cb_a''s addresses or orders'
);

-- Writes against another user's rows match nothing / violate with-check.
update notifications set is_read = true where customer_id = tests.get_supabase_uid('cb_a');
update cart_items set qty = 99 where cart_id = '00000000-0000-7000-8000-0000000b0021';
reset role;
select is(
  (select count(*)::int from notifications where customer_id = tests.get_supabase_uid('cb_a') and is_read = false)
  + (select count(*)::int from cart_items where cart_id = '00000000-0000-7000-8000-0000000b0021' and qty = 99),
  2,
  'cb_c''s UPDATEs against cb_a''s notifications / cart_items changed nothing (2 unread remain, no qty 99)'
);

select * from finish();
rollback;
