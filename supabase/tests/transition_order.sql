-- pgTAP: transition_order() — the only writer of orders.status (§10,
-- 0006_transition_order.sql). Same caveat as the other files in this
-- directory: not executed here (no Docker/Supabase CLI in this
-- environment), run via `supabase test db` or CI's `pgtap` job.
--
-- Two things this specifically guards: (1) the explicit allowed-transitions
-- table is actually enforced, not just documented; (2) the actor
-- authorization guard actually stops a stranger with a valid session from
-- moving an order they have no relationship to — a vendor accepting an
-- order at a *different* vendor is the sharpest version of that.

begin;
select plan(6);

select tests.create_supabase_user('customer_a');
select tests.create_supabase_user('vendor_owner_a');
select tests.create_supabase_user('vendor_owner_b'); -- staffs a different vendor

insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values
  ('00000000-0000-7000-8000-000000000030', tests.get_supabase_uid('vendor_owner_a'), 'Vendor A', 'test-vendor-a-transition', 'active', 1500),
  ('00000000-0000-7000-8000-000000000031', tests.get_supabase_uid('vendor_owner_b'), 'Vendor B', 'test-vendor-b-transition', 'active', 1500);

insert into vendor_staff (vendor_id, user_id, role) values
  ('00000000-0000-7000-8000-000000000030', tests.get_supabase_uid('vendor_owner_a'), 'vendor_owner'),
  ('00000000-0000-7000-8000-000000000031', tests.get_supabase_uid('vendor_owner_b'), 'vendor_owner');

insert into orders (id, customer_id, vendor_id, status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000032',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000030', -- belongs to Vendor A
  'placed', 500000, 50000, 10000, 0, 560000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);

select tests.authenticate_as_service_role();

-- An illegal edge (placed -> delivered skips the whole fulfillment chain)
-- must be rejected by the explicit allowed-transitions table.
select throws_ok(
  $$ select transition_order('00000000-0000-7000-8000-000000000032'::uuid, 'delivered', 'vendor', '00000000-0000-7000-8000-000000000030'::uuid) $$,
  'an illegal transition (placed -> delivered) is rejected by the allowed-transitions table'
);

-- Vendor B's owner has no relationship to this order (it belongs to
-- Vendor A) — must be rejected even though they're a legitimate,
-- authenticated vendor_staff member of *some* vendor.
select throws_ok(
  $$ select transition_order(
       '00000000-0000-7000-8000-000000000032'::uuid, 'accepted', 'vendor',
       (select user_id from vendor_staff where vendor_id = '00000000-0000-7000-8000-000000000031')
     ) $$,
  'a vendor with no staff relationship to this order''s vendor cannot transition it'
);

-- A stranger claiming to be "the customer" on someone else's order.
select throws_ok(
  $$ select transition_order('00000000-0000-7000-8000-000000000032'::uuid, 'accepted', 'customer', tests.get_supabase_uid('vendor_owner_b')) $$,
  'an actor claiming actor_type=customer who is not order.customer_id is rejected'
);

-- Vendor A's own staff, on their own order, doing a legal transition —
-- must succeed.
select is(
  (select status from transition_order(
     '00000000-0000-7000-8000-000000000032'::uuid, 'accepted', 'vendor',
     tests.get_supabase_uid('vendor_owner_a')
   )),
  'accepted',
  'the legitimate vendor staff member can advance their own order through a legal edge'
);

-- The order_events row is written in the same transaction, with the
-- correct from/to/actor recorded (§10's audit trail).
select is(
  (select to_status::text from order_events where order_id = '00000000-0000-7000-8000-000000000032' order by at desc limit 1),
  'accepted',
  'the transition is recorded in order_events'
);

select is(
  (select actor_type from order_events where order_id = '00000000-0000-7000-8000-000000000032' order by at desc limit 1),
  'vendor',
  'order_events records the correct actor_type'
);

select * from finish();
rollback;
