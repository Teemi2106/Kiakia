-- pgTAP: RLS coverage for the "client-owned scratch state" tables (carts,
-- cart_items, addresses) and the menu read-visibility rules
-- (0007_rls.sql). Same caveat as the other files in this directory: not
-- executed here (no Docker/Supabase CLI in this environment), run via
-- `supabase test db` or CI's `pgtap` job.

begin;
select plan(10);

select tests.create_supabase_user('customer_a');
select tests.create_supabase_user('customer_b');
select tests.create_supabase_user('vendor_owner_a');

insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values
  ('00000000-0000-7000-8000-000000000040', tests.get_supabase_uid('vendor_owner_a'), 'Pending Vendor', 'test-vendor-pending-rls', 'pending', 1500);

insert into vendor_staff (vendor_id, user_id, role)
values ('00000000-0000-7000-8000-000000000040', tests.get_supabase_uid('vendor_owner_a'), 'vendor_owner');

insert into menu_categories (id, vendor_id, name)
values ('00000000-0000-7000-8000-000000000041', '00000000-0000-7000-8000-000000000040', 'Mains');

-- ---------------------------------------------------------------------------
-- addresses — fully owned by the customer.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('customer_a');
insert into addresses (id, customer_id, label, line1, city, state, location)
values ('00000000-0000-7000-8000-000000000042', tests.get_supabase_uid('customer_a'), 'Home', '1 Test Street', 'Abuja', 'FCT', st_geogfromtext('POINT(7.45 9.05)'));

select is(
  (select count(*)::int from addresses where id = '00000000-0000-7000-8000-000000000042'),
  1,
  'a customer can insert and read their own address (direct RLS write, no Server Action)'
);

select tests.authenticate_as('customer_b');
select is(
  (select count(*)::int from addresses where id = '00000000-0000-7000-8000-000000000042'),
  0,
  'a different customer cannot read another customer''s address'
);

-- An UPDATE whose USING clause matches 0 rows doesn't raise an error (it's
-- not a with-check violation like an INSERT would be) — it silently
-- affects nothing. The real assertion is that the row is provably
-- untouched afterwards.
update addresses set label = 'Hacked' where id = '00000000-0000-7000-8000-000000000042';

select tests.authenticate_as('customer_a');
select is(
  (select label from addresses where id = '00000000-0000-7000-8000-000000000042'),
  'Home',
  'a different customer''s UPDATE against another customer''s address silently matches 0 rows and changes nothing'
);

-- ---------------------------------------------------------------------------
-- carts / cart_items — same "fully owned by the customer" shape.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('customer_a');
insert into carts (id, customer_id, status) values ('00000000-0000-7000-8000-000000000043', tests.get_supabase_uid('customer_a'), 'open');

select is(
  (select count(*)::int from carts where id = '00000000-0000-7000-8000-000000000043'),
  1,
  'a customer can create and read their own cart'
);

select tests.authenticate_as('customer_b');
select is(
  (select count(*)::int from carts where id = '00000000-0000-7000-8000-000000000043'),
  0,
  'a different customer cannot read another customer''s cart'
);

select throws_ok(
  $$ insert into cart_items (cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, line_total_kobo)
     values ('00000000-0000-7000-8000-000000000043', '00000000-0000-7000-8000-000000000041', 'x', 100, 1, 100) $$,
  'a different customer cannot insert cart_items into another customer''s cart (with-check fails)'
);

-- ---------------------------------------------------------------------------
-- menu_categories — public read is scoped to *active* vendors; the vendor's
-- own (possibly pending) staff can still see it; a stranger cannot.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('vendor_owner_a');
select is(
  (select count(*)::int from menu_categories where id = '00000000-0000-7000-8000-000000000041'),
  1,
  'vendor staff can read their own vendor''s menu even while the vendor is still pending (not yet active)'
);

select tests.authenticate_as('customer_a');
select is(
  (select count(*)::int from menu_categories where id = '00000000-0000-7000-8000-000000000041'),
  0,
  'an ordinary customer cannot read a pending (not yet active) vendor''s menu'
);

-- Direct writes to menu_categories are revoked from authenticated
-- entirely, even for the vendor's own staff — all menu writes go through
-- actions/menu.ts's Server Actions (admin client), not client-side RLS.
select tests.authenticate_as('vendor_owner_a');
select throws_ok(
  $$ insert into menu_categories (vendor_id, name) values ('00000000-0000-7000-8000-000000000040', 'Drinks') $$,
  '42501',
  null,
  'even the vendor''s own staff cannot write menu_categories directly — insert is revoked from authenticated'
);

-- ---------------------------------------------------------------------------
-- vendor_staff — a vendor's staff roster is not visible to other vendors.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('customer_a'); -- not staff anywhere
select is(
  (select count(*)::int from vendor_staff where vendor_id = '00000000-0000-7000-8000-000000000040'),
  0,
  'a non-staff user cannot read another vendor''s staff roster'
);

select * from finish();
rollback;
