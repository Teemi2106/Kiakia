-- pgTAP: 0030_require_escrow_release_before_delivered.sql — a transition
-- INTO 'delivered' is refused unless this order's escrow has already been
-- released (i.e. unless a "<order.code>-escrow"-referenced transactions row
-- already exists). Same caveat as every other file in this directory: not
-- executed here (no Docker/Supabase CLI in this environment), run via
-- `supabase test db` or CI's `pgtap` job.
--
-- What this protects, in order of how bad getting it wrong would be: (1)
-- the assigned rider must never be able to call transition_order() directly
-- to skip the delivery-code check and strand the order's escrowed money
-- forever — this is the P0 money-loss bug this migration fixes; (2) the
-- legitimate path, verify_delivery_and_release_escrow() with the correct
-- delivery code, must still work end to end and still produce a balanced
-- ledger, i.e. this fix must not have broken the one caller that's actually
-- supposed to reach 'delivered'; (3) the escrow-release idempotency
-- behaviour (a retried release call is a no-op, not a second credit) must
-- still hold with this migration in place.
--
-- throws_ok() calls below use the 4-arg form (sql, sqlstate, exact message,
-- description) — the 2-arg form treats the second argument as an expected-
-- message MATCH (pgTAP), not a free-text description (independent security
-- review, round 3, should-fix 12 — see transition_order.sql's own header).

begin;
select plan(6);

select tests.create_supabase_user('customer_a');
select tests.create_supabase_user('vendor_owner_a');
select tests.create_supabase_user('rider_a');

insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values ('00000000-0000-7000-8000-000000000060', tests.get_supabase_uid('vendor_owner_a'), 'Test Vendor', 'test-vendor-escrow-guard', 'active', 1500);

insert into riders (user_id, is_online) values (tests.get_supabase_uid('rider_a'), true);

-- ---------------------------------------------------------------------------
-- Order 061 — 'arrived', paid, escrow correctly funded, but the assigned
-- rider tries to skip verify_delivery_and_release_escrow() entirely and
-- call transition_order() directly. Before 0035 this succeeded outright,
-- permanently stranding the order's escrowed total_kobo (0020's own status
-- check refuses to run afterward once status is already 'delivered'). After
-- 0035, it must raise.
-- ---------------------------------------------------------------------------

insert into orders (id, customer_id, vendor_id, rider_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location, arrived_at)
values (
  '00000000-0000-7000-8000-000000000061',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000060',
  tests.get_supabase_uid('rider_a'),
  'arrived', 'paid', 500000, 50000, 10000, 0, 560000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)'),
  now() - interval '10 minutes'
);
insert into order_delivery_codes (order_id, code) values ('00000000-0000-7000-8000-000000000061', '6161');

-- Escrow genuinely holds total_kobo for this order — the rider is not being
-- rejected because escrow is short (0022 BLOCKING 2's concern), only
-- because they never went through verify_delivery_and_release_escrow() at
-- all, i.e. no "<order.code>-escrow" transactions row exists yet.
insert into transactions (id, kind, reference, order_id, description)
values (
  '00000000-0000-7000-8000-000000000161',
  'payment_capture', 'KK-ESCROW-GUARD-061', '00000000-0000-7000-8000-000000000061',
  'Test fixture: simulated payment capture for order 061'
);
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '00000000-0000-7000-8000-000000000161', a.id, 'debit', 560000, 'payment_capture', '00000000-0000-7000-8000-000000000061'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway';
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '00000000-0000-7000-8000-000000000161', a.id, 'credit', 560000, 'payment_capture', '00000000-0000-7000-8000-000000000061'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'escrow';

select tests.authenticate_as('rider_a');
select throws_ok(
  $$ select transition_order('00000000-0000-7000-8000-000000000061'::uuid, 'delivered', 'rider', tests.get_supabase_uid('rider_a')) $$,
  'P0001',
  'transition_order: order 00000000-0000-7000-8000-000000000061 cannot be marked delivered before its escrow has been released — call verify_delivery_and_release_escrow() with the customer''s delivery code instead',
  'the assigned rider cannot call transition_order() directly to reach delivered, skipping the delivery-code check and stranding escrow'
);

-- The rejected direct call must not have moved the order out of 'arrived',
-- nor written an order_events row for it.
select is(
  (select status from orders where id = '00000000-0000-7000-8000-000000000061'),
  'arrived',
  'the rejected direct transition_order() call does not change the order status'
);

select is(
  (select count(*)::int from order_events where order_id = '00000000-0000-7000-8000-000000000061' and to_status = 'delivered'),
  0,
  'the rejected direct transition_order() call does not write an order_events row'
);

-- ---------------------------------------------------------------------------
-- The legitimate path is unaffected: verify_delivery_and_release_escrow()
-- with the correct code inserts the escrow_release transaction FIRST, then
-- makes its own internal transition_order() call — which now finds that row
-- and proceeds normally.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('rider_a');
select ok(
  (select r.code_matched and (r.order_row).status = 'delivered'
   from verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000061'::uuid, '6161') r),
  'the legitimate path (verify_delivery_and_release_escrow with the correct code) still succeeds end to end under the 0035 guard'
);

select tests.authenticate_as_service_role();
select is(
  (select coalesce(sum(le.amount_kobo) filter (where le.direction = 'debit'), 0) from ledger_entries le join transactions t on t.id = le.transaction_id where t.order_id = '00000000-0000-7000-8000-000000000061' and t.kind = 'escrow_release'),
  (select coalesce(sum(le.amount_kobo) filter (where le.direction = 'credit'), 0) from ledger_entries le join transactions t on t.id = le.transaction_id where t.order_id = '00000000-0000-7000-8000-000000000061' and t.kind = 'escrow_release'),
  'the legitimate release still produces a balanced ledger (debits = credits) for the escrow_release transaction'
);

-- Idempotency is unbroken: a retried release call (e.g. a network retry) is
-- still a no-op, not a second credit, and does not hit the 0035 guard on its
-- own internal transition_order() call (the order is already 'delivered',
-- but the idempotency-first check in verify_delivery_and_release_escrow()
-- short-circuits before ever calling transition_order() again).
select tests.authenticate_as('rider_a');
select verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000061'::uuid, '6161');

select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from ledger_entries le join transactions t on t.id = le.transaction_id where t.order_id = '00000000-0000-7000-8000-000000000061' and t.kind = 'escrow_release'),
  4,
  'a duplicate release call after the 0035 guard is in place still does not create a second set of ledger entries'
);

select * from finish();
rollback;
