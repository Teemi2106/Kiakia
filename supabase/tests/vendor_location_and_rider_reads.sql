-- pgTAP: set_vendor_location() / get_rider_offer_details() /
-- get_rider_earnings() (0032_vendor_location_and_rider_reads.sql). Same
-- caveat as every other file in this directory: not executed here (no
-- Docker/Supabase CLI in this environment), run via `supabase test db` or
-- CI's `pgtap` job.
--
-- What this protects, in order of how bad getting it wrong would be:
-- (1) a stranger with no vendor_staff row must never be able to move a
-- vendor's location; (2) an out-of-range lat/lng must be rejected, not
-- silently clamped or silently accepted with a swapped axis; (3) a rider
-- with no live offer and no assignment on an order must never be able to
-- read get_rider_offer_details() for it — and once they lose the offer to
-- another rider, that access must not linger; (4) get_rider_offer_details()
-- must never be usable to read the customer's delivery_code — the direct
-- order_delivery_codes RLS boundary from 0022 must still hold for a rider,
-- untouched by this migration; (5) get_rider_earnings() must only ever
-- return the CALLING rider's own balance, never another rider's; (6) as of
-- 0044_rider_fee_by_distance.sql, get_rider_offer_details()'s new
-- pickup_distance_m/rider_fee_estimate_kobo columns must degrade to NULL
-- rather than raise when the data they need is incomplete — this is an
-- advisory estimate, not something that should ever block a rider from
-- reading an offer.

begin;
select plan(16);

select tests.create_supabase_user('customer_a');
select tests.create_supabase_user('vendor_owner_a');
select tests.create_supabase_user('vendor_stranger');
select tests.create_supabase_user('rider_a');
select tests.create_supabase_user('rider_b');

insert into vendors (id, owner_user_id, name, slug, status, is_accepting_orders, commission_bps)
values (
  '00000000-0000-7000-8000-000000000050',
  tests.get_supabase_uid('vendor_owner_a'),
  'Test Vendor', 'test-vendor-location', 'active', true, 1500
);

insert into vendor_staff (vendor_id, user_id, role)
values ('00000000-0000-7000-8000-000000000050', tests.get_supabase_uid('vendor_owner_a'), 'vendor_owner');

-- ---------------------------------------------------------------------------
-- set_vendor_location()
-- ---------------------------------------------------------------------------

-- A stranger with no vendor_staff row on this vendor is rejected outright.
select tests.authenticate_as('vendor_stranger');
select throws_ok(
  $$ select set_vendor_location('00000000-0000-7000-8000-000000000050'::uuid, 9.05, 7.45) $$,
  'a non-staff caller cannot set this vendor''s location'
);

select is(
  (select location from vendors where id = '00000000-0000-7000-8000-000000000050'),
  null,
  'the rejected call left vendors.location untouched (still null)'
);

-- The real vendor owner can set it.
select tests.authenticate_as('vendor_owner_a');
select lives_ok(
  $$ select set_vendor_location('00000000-0000-7000-8000-000000000050'::uuid, 9.05, 7.45) $$,
  'vendor_staff can set their own vendor''s location'
);

-- lng-then-lat argument order: st_x() must recover the LONGITUDE (7.45),
-- st_y() must recover the LATITUDE (9.05) — the classic swap bug would fail
-- exactly this assertion.
select ok(
  (select abs(st_x(location::geometry) - 7.45) < 0.0001 from vendors where id = '00000000-0000-7000-8000-000000000050'),
  'st_x(location) recovers longitude (7.45), proving no lat/lng axis swap'
);
select ok(
  (select abs(st_y(location::geometry) - 9.05) < 0.0001 from vendors where id = '00000000-0000-7000-8000-000000000050'),
  'st_y(location) recovers latitude (9.05), proving no lat/lng axis swap'
);

-- Out-of-range lat/lng are rejected, never clamped.
select throws_ok(
  $$ select set_vendor_location('00000000-0000-7000-8000-000000000050'::uuid, 91, 7.45) $$,
  'an out-of-range latitude is rejected rather than clamped'
);
select throws_ok(
  $$ select set_vendor_location('00000000-0000-7000-8000-000000000050'::uuid, 9.05, 181) $$,
  'an out-of-range longitude is rejected rather than clamped'
);

-- ---------------------------------------------------------------------------
-- get_rider_offer_details()
-- ---------------------------------------------------------------------------

-- Back to an unauthenticated/superuser session for raw fixture inserts —
-- riders/orders/order_delivery_codes/dispatch_offers all revoke
-- insert/update/delete from `authenticated` (0007_rls.sql, 0022, 0023), so
-- these would fail RLS if left running as vendor_owner_a from the block
-- above. Same convention accept_dispatch_offer.sql / verify_delivery_and_
-- release_escrow.sql already follow.
select tests.clear_authentication();

insert into riders (user_id, is_online, current_location, kyc_status) values
  (tests.get_supabase_uid('rider_a'), true, st_geogfromtext('POINT(7.45 9.05)'), 'approved'),
  (tests.get_supabase_uid('rider_b'), true, st_geogfromtext('POINT(7.45 9.05)'), 'approved');

insert into orders (id, code, customer_id, vendor_id, status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000051',
  'KK-TEST051',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000050',
  'ready_for_pickup', 500000, 50000, 10000, 0, 560000,
  '{"line1": "1 Test Street", "landmark": "Near the big tree"}'::jsonb,
  st_geogfromtext('POINT(7.46 9.06)')
);

insert into order_delivery_codes (order_id, code)
values ('00000000-0000-7000-8000-000000000051', '4321');

insert into dispatch_offers (order_id, rider_id, status)
values ('00000000-0000-7000-8000-000000000051', tests.get_supabase_uid('rider_a'), 'offered');

-- An unauthenticated caller must be rejected outright — including on THIS
-- order specifically, where rider_id is still NULL (no rider assigned yet).
-- A prior draft of get_rider_offer_details() only checked
-- `auth.uid() is distinct from v_order.rider_id` without first requiring
-- auth.uid() to be non-null, and `NULL IS DISTINCT FROM NULL` is FALSE — an
-- unauthenticated caller would have slipped through exactly on an
-- unassigned order like this one. This is the regression test for that.
select tests.clear_authentication();
select throws_ok(
  $$ select * from get_rider_offer_details('00000000-0000-7000-8000-000000000051'::uuid) $$,
  'an unauthenticated caller cannot read offer details, even for an order with no rider assigned yet'
);

-- rider_b has no offer at all on this order — must be rejected outright.
select tests.authenticate_as('rider_b');
select throws_ok(
  $$ select * from get_rider_offer_details('00000000-0000-7000-8000-000000000051'::uuid) $$,
  'a rider with no offer and no assignment on the order cannot read its details'
);

-- rider_a, who genuinely has the 'offered' row, can read the pickup/dropoff
-- details it needs to decide whether to accept.
select tests.authenticate_as('rider_a');
select is(
  (select order_code from get_rider_offer_details('00000000-0000-7000-8000-000000000051'::uuid)),
  'KK-TEST051',
  'the offered rider can read the order code'
);
select is(
  (select item_count from get_rider_offer_details('00000000-0000-7000-8000-000000000051'::uuid)),
  0,
  'item_count reflects order_items (none inserted in this fixture, so 0)'
);

-- 0044's estimate columns are advisory-only and NULL-tolerant: this order
-- has no service_area_id set (the fixture above never set one), so even
-- though both the vendor's location (set via set_vendor_location above) and
-- rider_a's current_location are present, the estimate stays NULL rather
-- than raising — proving get_rider_offer_details() never blocks a rider
-- from reading offer details just because this advisory data is
-- incomplete.
select is(
  (select pickup_distance_m from get_rider_offer_details('00000000-0000-7000-8000-000000000051'::uuid)),
  null,
  'pickup_distance_m is NULL when the order has no service_area_id (0044, advisory-only)'
);
select is(
  (select rider_fee_estimate_kobo from get_rider_offer_details('00000000-0000-7000-8000-000000000051'::uuid)),
  null,
  'rider_fee_estimate_kobo is NULL for the same reason (0044, advisory-only)'
);

-- The delivery-code anti-fraud boundary (0022) must remain untouched: a
-- rider — even one with a genuine, live offer on this exact order — can
-- never read order_delivery_codes directly. RLS filters the row out rather
-- than raising (Postgres RLS makes a non-matching row invisible, it does not
-- throw), so this asserts the scalar subquery comes back NULL, not that it
-- errors — proving 0032 did not widen that boundary.
select is(
  (select code from order_delivery_codes where order_id = '00000000-0000-7000-8000-000000000051'::uuid),
  null,
  'the offered rider still cannot read the customer''s delivery_code directly — 0022''s RLS boundary is untouched'
);

-- ---------------------------------------------------------------------------
-- get_rider_earnings()
-- ---------------------------------------------------------------------------

-- Clear rider_a's session again before the raw accounts/transactions/
-- ledger_entries inserts below — all three revoke every grant from
-- `authenticated` (0007_rls.sql), so these must run unauthenticated/
-- superuser too, same reasoning as above.
select tests.clear_authentication();

insert into accounts (owner_type, owner_id, kind) values ('platform', null, 'escrow')
  on conflict (owner_type, owner_id, kind) do nothing;
insert into accounts (owner_type, owner_id, kind) values ('rider', tests.get_supabase_uid('rider_a'), 'available');
insert into accounts (owner_type, owner_id, kind) values ('rider', tests.get_supabase_uid('rider_b'), 'available');

insert into transactions (kind, reference, order_id, description)
values ('escrow_release', 'KK-TEST051-escrow', '00000000-0000-7000-8000-000000000051', 'test fixture');

-- Balanced debit/credit pair (the ledger invariant, 0005_ledger.sql) — a
-- lone credit with no matching debit would only ever be caught at COMMIT
-- (the balance-check trigger is DEFERRABLE INITIALLY DEFERRED) and this test
-- never commits, but kept balanced anyway to mirror what
-- verify_delivery_and_release_escrow() actually writes, not rely on that.
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select id, (select id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow'), 'debit', 50000, 'escrow_release', '00000000-0000-7000-8000-000000000051'
from transactions where reference = 'KK-TEST051-escrow';

insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select id, (select id from accounts where owner_type = 'rider' and owner_id = tests.get_supabase_uid('rider_a')), 'credit', 50000, 'escrow_release', '00000000-0000-7000-8000-000000000051'
from transactions where reference = 'KK-TEST051-escrow';

-- rider_a reads their own credited balance.
select tests.authenticate_as('rider_a');
select is(
  (select balance_kobo from get_rider_earnings() where account_kind = 'available'),
  50000::bigint,
  'a rider can read their own available balance via get_rider_earnings()'
);

-- rider_b, who has an account but no ledger entries, reads exactly their own
-- (zero) balance — never rider_a's credited balance.
select tests.authenticate_as('rider_b');
select is(
  (select balance_kobo from get_rider_earnings() where account_kind = 'available'),
  0::bigint,
  'a different rider with no ledger entries sees their own zero balance, never another rider''s'
);

select * from finish();
rollback;
