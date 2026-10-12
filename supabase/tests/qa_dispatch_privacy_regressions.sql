-- pgTAP: QA end-to-end sweep regressions (2026-09-24). NOT EXECUTED - written
-- without Docker; run via `supabase test db` before trusting it. Every
-- assertion below was first PROVEN against the live linked project with real
-- authenticated sessions (see the QA report) and are now hard gates: each
-- behavior below was FIXED by 0075/0076/0077 (the same behaviors were re-verified
-- live in a rolled-back transaction after the fix).
--
--   1. an offered-but-not-accepted rider can read customer_phone (0072).
--   2. dispatch_order_to_nearby_riders() offers to a rider whose last_ping_at
--      is stale (the sweep has a 5 minute guard, the trigger and the early
--      sweep do not).
--   3. an expired offer is never re-offered in a later cycle, because
--      dispatch_offers is UNIQUE(order_id, rider_id) and the sweep inserts
--      with ON CONFLICT DO NOTHING.
--   4. an order whose vendor has no location sits at ready_for_pickup
--      forever (sweep `continue`s before the 30 minute give-up).
--   5. accept_dispatch_offer() accepts a rider so far away that rider_fee
--      exceeds what the order can pay, guaranteeing verify_delivery_and_
--      release_escrow() later refuses with "negative payout share".

begin;
select plan(5);

select tests.create_supabase_user('qa_customer');
select tests.create_supabase_user('qa_vendor_owner');
select tests.create_supabase_user('qa_rider_fresh');
select tests.create_supabase_user('qa_rider_stale');

update profiles set phone = '+2348012345678' where id = tests.get_supabase_uid('qa_customer');

insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
values ('00000000-0000-7000-8000-0000000000a0', 'QA Area',
  st_geogfromtext('POLYGON((7.0 9.0, 8.0 9.0, 8.0 10.0, 7.0 10.0, 7.0 9.0))'), true, 50000, 15000, 50000, 15000);

insert into vendors (id, owner_user_id, name, slug, status, is_accepting_orders, location, commission_bps, avg_prep_mins)
values ('00000000-0000-7000-8000-0000000000a1', tests.get_supabase_uid('qa_vendor_owner'), 'QA Vendor', 'qa-vendor-dispatch', 'active', true,
  st_geogfromtext('POINT(7.5 9.5)'), 1500, 15);
insert into vendor_staff (vendor_id, user_id, role)
values ('00000000-0000-7000-8000-0000000000a1', tests.get_supabase_uid('qa_vendor_owner'), 'vendor_owner');

insert into riders (user_id, is_online, current_location, kyc_status, last_ping_at) values
  (tests.get_supabase_uid('qa_rider_fresh'), true, st_geogfromtext('POINT(7.5 9.5)'), 'approved', now()),
  (tests.get_supabase_uid('qa_rider_stale'), true, st_geogfromtext('POINT(7.5 9.5)'), 'approved', now() - interval '47 minutes');

-- An order already at accepted (paid), then moved to ready_for_pickup by the
-- vendor through transition_order so the real trigger fires.
insert into orders (id, customer_id, vendor_id, service_area_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values ('00000000-0000-7000-8000-0000000000a2', tests.get_supabase_uid('qa_customer'), '00000000-0000-7000-8000-0000000000a1',
  '00000000-0000-7000-8000-0000000000a0', 'preparing', 'paid', 250000, 95000, 5000, 0, 350000,
  '{"line1": "1 QA Street"}'::jsonb, st_geogfromtext('POINT(7.52 9.52)'));

select tests.authenticate_as('qa_vendor_owner');
select transition_order('00000000-0000-7000-8000-0000000000a2'::uuid, 'ready_for_pickup', 'vendor', tests.get_supabase_uid('qa_vendor_owner'), '{}'::jsonb);

-- (1) privacy
select tests.authenticate_as('qa_rider_fresh');
select is(
  (select customer_phone from get_rider_offer_details('00000000-0000-7000-8000-0000000000a2'::uuid)),
  null::text,
  'a rider who only holds an offer (not yet accepted) must not see the customer phone'
);

-- (2) stale rider
select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from dispatch_offers where order_id = '00000000-0000-7000-8000-0000000000a2' and rider_id = tests.get_supabase_uid('qa_rider_stale')),
  0,
  'the ready_for_pickup trigger must skip a rider whose last_ping_at is older than 5 minutes'
);

-- (3) expired offers never re-offered
-- Everything in a pgTAP file runs in ONE transaction, so now() is frozen: the
-- fixture offer's offered_at and the order's dispatch_cycle_started_at are the
-- same instant as the sweep's own now(), and 0076's cycle rule
-- (offered_at >= cycle start => already asked this cycle) would exclude the rider
-- forever. In production each sweep tick is its own transaction. Age the offer and
-- the cycle into the past so the expired-offer re-open path is what is exercised.
update dispatch_offers set expires_at = now() - interval '1 second', offered_at = now() - interval '3 minutes'
 where order_id = '00000000-0000-7000-8000-0000000000a2' and status = 'offered';
update orders set dispatch_cycle_started_at = now() - interval '5 minutes' where id = '00000000-0000-7000-8000-0000000000a2';
select sweep_dispatch_offers();
select sweep_dispatch_offers();
select is(
  (select status from dispatch_offers where order_id = '00000000-0000-7000-8000-0000000000a2' and rider_id = tests.get_supabase_uid('qa_rider_fresh')),
  'offered',
  'an expired, still-eligible rider is re-offered in the next cycle'
);

-- (5) rider too far for the order to pay: accept must be refused up front
update dispatch_offers set status = 'offered', expires_at = now() + interval '2 minutes'
 where order_id = '00000000-0000-7000-8000-0000000000a2' and rider_id = tests.get_supabase_uid('qa_rider_fresh');
update riders set current_location = st_geogfromtext('POINT(7.95 9.95)') where user_id = tests.get_supabase_uid('qa_rider_fresh');
select tests.authenticate_as('qa_rider_fresh');
select throws_ok(
  $$ select accept_dispatch_offer('00000000-0000-7000-8000-0000000000a2'::uuid) $$,
  '23514', -- check_violation, 0076
  'accept_dispatch_offer: order 00000000-0000-7000-8000-0000000000a2 is too far from this rider - the payout would exceed what the order can fund',
  'accepting an order whose rider_fee would exceed the order''s payable share must fail at accept time, not after delivery'
);

-- (4) vendor with no location
select tests.authenticate_as_service_role();
update vendors set location = null where id = '00000000-0000-7000-8000-0000000000a1';
-- The rider's offer from the steps above is still live ('offered'), and the sweep
-- (rightly) leaves an order with a live offer alone, so let it lapse first.
update dispatch_offers set expires_at = now() - interval '1 second'
 where order_id = '00000000-0000-7000-8000-0000000000a2' and status = 'offered';
update orders set first_dispatched_at = now() - interval '40 minutes' where id = '00000000-0000-7000-8000-0000000000a2' and rider_id is null;
select sweep_dispatch_offers();
select isnt(
  (select status::text from orders where id = '00000000-0000-7000-8000-0000000000a2'),
  'ready_for_pickup',
  'an undispatchable order older than 30 minutes is cancelled and refunded, not stuck'
);

select * from finish();
rollback;
