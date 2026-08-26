-- pgTAP: transition_order() — the only writer of orders.status (§10,
-- 0006_transition_order.sql, actor-identity fix in
-- 0015_fix_transition_order_actor_forgery.sql). Same caveat as the other
-- files in this directory: not executed here (no Docker/Supabase CLI in
-- this environment), run via `supabase test db` or CI's `pgtap` job.
--
-- What this specifically guards, in order of how bad getting it wrong
-- would be: (1) the actor's identity is derived from the SESSION
-- (auth.uid()/auth.role()), never trusted from the p_actor_id/p_actor_type
-- arguments alone — a forged p_actor_id claiming to be someone else must
-- be rejected even before the order-relationship check runs, and
-- actor_type=system must be unusable by anything but the service-role key;
-- (2) the explicit allowed-transitions table is actually enforced, not
-- just documented; (3) the actor authorization guard actually stops a
-- stranger with a valid session from moving an order they have no
-- relationship to — a vendor accepting an order at a *different* vendor is
-- the sharpest version of that.
--
-- throws_ok() calls below use the 4-arg form (sql, sqlstate, exact message,
-- description) — the 2-arg form used in an earlier draft of this file
-- treats the second argument as an expected-message MATCH (pgTAP), not a
-- free-text description, so it silently asserted the wrong thing
-- (independent security review, round 3, should-fix 12).

begin;
select plan(9);

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

-- A second order, still in 'draft' (unpaid) — the fixture for the
-- edge-restriction fix (0018_fix_transition_order_edge_restrictions.sql).
insert into orders (id, customer_id, vendor_id, status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000034',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000030', -- belongs to Vendor A
  'draft', 500000, 50000, 10000, 0, 560000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);

-- An illegal edge (placed -> delivered skips the whole fulfillment chain)
-- must be rejected by the explicit allowed-transitions table, even for
-- Vendor A's own legitimate staff member acting on their own order.
select tests.authenticate_as('vendor_owner_a');
select throws_ok(
  $$ select transition_order('00000000-0000-7000-8000-000000000032'::uuid, 'delivered', 'vendor', tests.get_supabase_uid('vendor_owner_a')) $$,
  'P0001',
  'transition_order: actor_type=vendor may not drive an order to delivered',
  'an illegal transition (placed -> delivered) is rejected — here, by the per-actor-type allow-list (0018), before the allowed-transitions table is even consulted'
);

-- Vendor B's owner has no relationship to this order (it belongs to
-- Vendor A) — must be rejected even though they're a legitimate,
-- authenticated vendor_staff member of *some* vendor, and even though
-- p_actor_id truthfully matches their own auth.uid().
select tests.authenticate_as('vendor_owner_b');
select throws_ok(
  $$ select transition_order(
       '00000000-0000-7000-8000-000000000032'::uuid, 'accepted', 'vendor',
       tests.get_supabase_uid('vendor_owner_b')
     ) $$,
  'P0001',
  'transition_order: actor is not staff on vendor 00000000-0000-7000-8000-000000000030',
  'a vendor with no staff relationship to this order''s vendor cannot transition it'
);

-- A stranger claiming to be "the customer" on someone else's order, with a
-- truthful p_actor_id (their own uid) — order.customer_id still doesn't match.
select tests.authenticate_as('vendor_owner_b');
select throws_ok(
  $$ select transition_order('00000000-0000-7000-8000-000000000032'::uuid, 'accepted', 'customer', tests.get_supabase_uid('vendor_owner_b')) $$,
  'P0001',
  'transition_order: actor is not the customer on order 00000000-0000-7000-8000-000000000032',
  'an actor claiming actor_type=customer who is not order.customer_id is rejected'
);

-- The core forgery this fix closes: an authenticated session (vendor_owner_b)
-- passing SOMEONE ELSE's uid (vendor_owner_a, the real staff of this
-- order's vendor) as p_actor_id. Before 0015, this succeeded — the check
-- only ever compared p_actor_id (fully attacker-controlled) against the
-- order's relationships, never against who actually holds the session.
select tests.authenticate_as('vendor_owner_b');
select throws_ok(
  $$ select transition_order(
       '00000000-0000-7000-8000-000000000032'::uuid, 'accepted', 'vendor',
       tests.get_supabase_uid('vendor_owner_a')
     ) $$,
  'P0001',
  'transition_order: actor is not staff on vendor 00000000-0000-7000-8000-000000000030',
  'a caller cannot forge p_actor_id to claim someone else''s identity, even when that identity would otherwise be authorized'
);

-- actor_type=system (and by the same code path, admin) must be unusable
-- by any plain `authenticated` session, regardless of p_actor_id — only
-- the service-role key may claim it (capture_payment's internal call,
-- pg_cron, the dispatch orchestrator).
select tests.authenticate_as('vendor_owner_a');
select throws_ok(
  $$ select transition_order('00000000-0000-7000-8000-000000000032'::uuid, 'accepted', 'system', null) $$,
  'P0001',
  'transition_order: actor_type=system requires the service-role key',
  'actor_type=system is rejected for any caller that is not the service-role key'
);

-- Vendor A's own staff, on their own order, doing a legal transition, with
-- a p_actor_id that truthfully matches their own auth.uid() — must succeed.
select tests.authenticate_as('vendor_owner_a');
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

-- B1 (independent security review, 0018_fix_transition_order_edge_restrictions.sql):
-- 0015 alone let a customer push their OWN unpaid draft order straight to
-- 'placed' — draft -> placed is a legal edge in order_status_transitions
-- (it's how capture_payment() confirms a paid order), and before 0018 a
-- customer actor's p_to_status was never restricted, only their identity
-- and relationship to the order. This is the exact "any customer can call
-- transition_order(their_own_draft_order, 'placed', 'customer', their_own_uid)"
-- bug 0015's own header claimed to close but didn't.
select tests.authenticate_as('customer_a');
select throws_ok(
  $$ select transition_order(
       '00000000-0000-7000-8000-000000000034'::uuid, 'placed', 'customer',
       tests.get_supabase_uid('customer_a')
     ) $$,
  'P0001',
  'transition_order: actor_type=customer may not drive an order to placed— only cancelled_by_customer',
  'a customer cannot push their own unpaid draft order to placed — only cancelled_by_customer is a valid customer-driven edge'
);

select * from finish();
rollback;
