-- pgTAP: accept_dispatch_offer() — the only way a dispatch_offers row
-- becomes an assignment (0019_rider_dispatch.sql, KYC-gated in
-- 0023_rider_dispatch_kyc_hardening.sql — independent security review,
-- round 3, blocking finding 4). Same caveat as every other file in this
-- directory: not executed here (no Docker/Supabase CLI in this
-- environment), run via `supabase test db` or CI's `pgtap` job.
--
-- What this protects, in order of how bad getting it wrong would be: (1) a
-- rider whose own KYC isn't approved must never be able to accept an offer,
-- even one that was genuinely made to them before a later KYC rejection;
-- (2) a rider with no active offer on an order must never be able to
-- assign themselves to it; (3) once assigned, a second rider (even one who
-- also had — or still has — an 'offered' row) cannot also accept it; (4)
-- the order_events audit trail is written with the correct actor/edge,
-- mirroring transition_order()'s own insert shape.
--
-- throws_ok() calls below use the 4-arg form (sql, sqlstate, exact message,
-- description) — the 2-arg form used in an earlier draft of this file
-- treats the second argument as an expected-message MATCH (pgTAP), not a
-- free-text description, so it silently asserted the wrong thing.
--
-- As of 0044_rider_fee_by_distance.sql, accept_dispatch_offer() also
-- computes orders.rider_fee_kobo from the accepting rider's own location,
-- the vendor's location, and the order's service_area_id — so this
-- fixture now seeds a service_areas row and references it, and asserts
-- the computed fee below.

begin;
select plan(8);

select tests.create_supabase_user('customer_a');
select tests.create_supabase_user('vendor_owner_a');
select tests.create_supabase_user('rider_a');
select tests.create_supabase_user('rider_b');
select tests.create_supabase_user('rider_c'); -- KYC pending — never approved

insert into vendors (id, owner_user_id, name, slug, status, is_accepting_orders, location, commission_bps)
values (
  '00000000-0000-7000-8000-000000000040',
  tests.get_supabase_uid('vendor_owner_a'),
  'Test Vendor', 'test-vendor-dispatch', 'active', true,
  st_geogfromtext('POINT(7.5 9.5)'), 1500
);

-- Needed by accept_dispatch_offer() (0044) to compute rider_fee_kobo — the
-- rate values mirror supabase/seed.sql's dev placeholders.
insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
values (
  '00000000-0000-7000-8000-000000000042',
  'Test Service Area',
  st_geogfromtext('POLYGON((7.4 9.0, 7.6 9.0, 7.6 9.6, 7.4 9.6, 7.4 9.0))'),
  true, 50000, 15000, 50000, 15000
);

-- rider_a and rider_b are both online AND kyc-approved — the baseline
-- eligible-rider fixture. rider_c is online but still kyc_status='pending'
-- (the column's own default, 0002_identity.sql) — never approved, used
-- below to prove BLOCKING 4's fix actually rejects it even though it holds
-- a genuinely-offered row.
insert into riders (user_id, is_online, current_location, kyc_status) values
  (tests.get_supabase_uid('rider_a'), true, st_geogfromtext('POINT(7.5 9.5)'), 'approved'),
  (tests.get_supabase_uid('rider_b'), true, st_geogfromtext('POINT(7.5 9.5)'), 'approved'),
  (tests.get_supabase_uid('rider_c'), true, st_geogfromtext('POINT(7.5 9.5)'), 'pending');

-- Seeded directly at 'ready_for_pickup' — this fixture tests
-- accept_dispatch_offer() in isolation, not the dispatch trigger itself
-- (which only fires on an UPDATE OF status transition, not a fixture INSERT
-- already at the target status), same convention other tests in this suite
-- use (e.g. supabase/tests/transition_order.sql seeding orders directly at
-- a target status rather than driving the whole state machine).
insert into orders (id, customer_id, vendor_id, service_area_id, status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000041',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000040',
  '00000000-0000-7000-8000-000000000042',
  'ready_for_pickup', 500000, 50000, 10000, 0, 560000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);

-- rider_a has an active offer (what the dispatch trigger would have
-- created); rider_c also genuinely has one (simulating an offer made
-- before rider_c's later KYC rejection/pending state) — used below to prove
-- the KYC check applies even to a real, non-forged offer.
insert into dispatch_offers (order_id, rider_id, status)
values
  ('00000000-0000-7000-8000-000000000041', tests.get_supabase_uid('rider_a'), 'offered'),
  ('00000000-0000-7000-8000-000000000041', tests.get_supabase_uid('rider_c'), 'offered');

-- rider_b has no offer at all on this order — must be rejected outright.
select tests.authenticate_as('rider_b');
select throws_ok(
  $$ select accept_dispatch_offer('00000000-0000-7000-8000-000000000041'::uuid) $$,
  'P0001',
  'accept_dispatch_offer: no active offer for this rider on this order',
  'a rider without an active offer on this order cannot accept it'
);

-- rider_c genuinely has an 'offered' row but is not kyc-approved — must be
-- rejected by the KYC check, BEFORE the offer-existence check even matters
-- (0023_rider_dispatch_kyc_hardening.sql, BLOCKING 4).
select tests.authenticate_as('rider_c');
select throws_ok(
  $$ select accept_dispatch_offer('00000000-0000-7000-8000-000000000041'::uuid) $$,
  'P0001',
  'accept_dispatch_offer: rider is not kyc-approved',
  'a rider with a genuine offer but unapproved KYC cannot accept it'
);

-- rider_a, who genuinely has the 'offered' row AND is kyc-approved, accepts
-- successfully.
select tests.authenticate_as('rider_a');
select is(
  (select status from accept_dispatch_offer('00000000-0000-7000-8000-000000000041'::uuid)),
  'rider_assigned',
  'the kyc-approved rider with an active offer can accept it, moving the order to rider_assigned'
);

select is(
  (select rider_id from orders where id = '00000000-0000-7000-8000-000000000041'),
  tests.get_supabase_uid('rider_a'),
  'orders.rider_id is set to the accepting rider'
);

-- rider_a and the vendor share the exact same point in this fixture (both
-- POINT(7.5 9.5)), so the pickup leg is ~0m; distance_m is unset (NULL,
-- coalesced to 0) on this directly-seeded order, so the dropoff leg is also
-- 0 -> rider_fee_kobo is exactly rider_base_fee_kobo (50000), proving the
-- fee is actually being computed from the service area's rider rates
-- rather than left at its 0 default.
select is(
  (select rider_fee_kobo from orders where id = '00000000-0000-7000-8000-000000000041'),
  50000::bigint,
  'accept_dispatch_offer computes rider_fee_kobo from the service area''s rider rates (0044)'
);

select is(
  (select status from dispatch_offers where order_id = '00000000-0000-7000-8000-000000000041' and rider_id = tests.get_supabase_uid('rider_a')),
  'accepted',
  'the accepting rider''s own offer row is marked accepted'
);

select is(
  (select to_status::text from order_events where order_id = '00000000-0000-7000-8000-000000000041' order by at desc limit 1),
  'rider_assigned',
  'accept_dispatch_offer writes the matching order_events row, mirroring transition_order()''s own insert shape'
);

-- A second rider, even with their own freshly-offered row, cannot accept an
-- order that is already assigned — orders.rider_id is no longer null, which
-- accept_dispatch_offer() checks independently of dispatch_offers.status.
select tests.clear_authentication();
insert into dispatch_offers (order_id, rider_id, status)
values ('00000000-0000-7000-8000-000000000041', tests.get_supabase_uid('rider_b'), 'offered');
select tests.authenticate_as('rider_b');
select throws_ok(
  $$ select accept_dispatch_offer('00000000-0000-7000-8000-000000000041'::uuid) $$,
  'P0001',
  'accept_dispatch_offer: order already assigned or not ready for pickup',
  'a second rider cannot accept an order that is already assigned, even with their own offered row'
);

select * from finish();
rollback;
