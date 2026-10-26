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
--      with ON CONFLICT DO NOTHING. (Sequential dispatch, 0100+: there is no
--      pair-unique and no re-opening; the equivalent guarantee is that after
--      the lapse a NEW offer row, in a later cycle, goes to the same rider.)
--   4. an order whose vendor has no location sits at ready_for_pickup
--      forever (sweep `continue`s before the 30 minute give-up).
--   5. accept_dispatch_offer() accepts a rider so far away that rider_fee
--      exceeds what the order can pay, guaranteeing verify_delivery_and_
--      release_escrow() later refuses with "negative payout share".

begin;
select plan(8);

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

-- Sequential dispatch: the ready trigger made ONE live offer, to the fresh rider (the stale one is skipped).
select tests.authenticate_as_service_role();
select is(
  (select array_agg(rider_id) from dispatch_offers where order_id = '00000000-0000-7000-8000-0000000000a2' and status = 'offered'),
  array[tests.get_supabase_uid('qa_rider_fresh')],
  'the ready trigger made exactly one live offer, to the fresh rider (sequential dispatch)'
);

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

-- Offer columns (expires_at, offered_at, cycle_no, attempt_no, ...) are immutable once a row exists, so a
-- lapsed offer cannot be faked by UPDATE. This helper swaps the live offer for an identical one that was
-- already past its expiry when it was inserted (same rider/cycle/attempt, offered 3 minutes ago).
reset role;
create function pg_temp.lapse_live(p_order uuid) returns void language plpgsql as $$
declare
  r record;
begin
  delete from dispatch_offers where order_id = p_order and status = 'offered' returning * into r;
  insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
  values (r.order_id, r.rider_id, 'offered', r.cycle_no, r.attempt_no, now() - interval '3 minutes', now() - interval '1 second');
end $$;
select tests.authenticate_as_service_role();

-- (3) expired offers: the next cycle asks the still-eligible rider again
-- Everything in a pgTAP file runs in ONE transaction, so now() is frozen: the
-- fixture offer's offered_at and the order's dispatch_cycle_started_at are the
-- same instant as the sweep's own now(), and 0076's cycle rule
-- (offered_at >= cycle start => already asked this cycle) would exclude the rider
-- forever. In production each sweep tick is its own transaction. Age the offer and
-- the cycle into the past so the expired-offer re-open path is what is exercised.
reset role;
select pg_temp.lapse_live('00000000-0000-7000-8000-0000000000a2'::uuid);
select tests.authenticate_as_service_role();
update orders set dispatch_cycle_started_at = now() - interval '5 minutes' where id = '00000000-0000-7000-8000-0000000000a2';
select sweep_dispatch_offers();
select sweep_dispatch_offers();
select is(
  (select status from dispatch_offers where order_id = '00000000-0000-7000-8000-0000000000a2' and rider_id = tests.get_supabase_uid('qa_rider_fresh') order by attempt_no limit 1),
  'expired',
  'the lapsed offer is closed as expired by the sweep (old: re-opened in place)'
);
select is(
  (select count(*)::int from dispatch_offers where order_id = '00000000-0000-7000-8000-0000000000a2' and rider_id = tests.get_supabase_uid('qa_rider_fresh') and status = 'offered' and cycle_no > 1),
  1,
  'an expired, still-eligible rider is re-offered in the NEXT cycle, as a new offer row (exactly one live offer)'
);
select is(
  (select count(*)::int from dispatch_offers where order_id = '00000000-0000-7000-8000-0000000000a2' and status = 'offered'),
  1,
  '... and the repeated sweep did not create a second live offer for the order'
);

-- (5) rider too far for the order to pay: accept must be refused up front
-- (the rider's live offer from the new cycle is still open; only the rider's position changes)
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
reset role;
select pg_temp.lapse_live('00000000-0000-7000-8000-0000000000a2'::uuid);
select tests.authenticate_as_service_role();
update orders set first_dispatched_at = now() - interval '40 minutes' where id = '00000000-0000-7000-8000-0000000000a2' and rider_id is null;
select sweep_dispatch_offers();
select isnt(
  (select status::text from orders where id = '00000000-0000-7000-8000-0000000000a2'),
  'ready_for_pickup',
  'an undispatchable order older than 30 minutes is cancelled and refunded, not stuck'
);

select * from finish();
rollback;
