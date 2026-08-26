-- pgTAP: verify_delivery_and_release_escrow() — the only writer of
-- escrow_release ledger entries and the only path from 'arrived' to
-- 'delivered' (0020_verify_delivery_and_release_escrow.sql, hardened by
-- 0022_delivery_code_off_orders.sql and 0025_fix_delivery_code_rate_limit_
-- persistence.sql — see those migrations' headers for the BLOCKING 1/2,
-- SHOULD-FIX 5/6/7, and rate-limit-persistence findings this file now
-- asserts). Same caveat as every other file in this directory: not executed
-- here (no Docker/Supabase CLI in this environment), run via
-- `supabase test db` or CI's `pgtap` job.
--
-- What this protects, in order of how bad getting it wrong would be: (1) a
-- rider who is not the assigned rider on the order must never be able to
-- release its escrow; (2) escrow must never release unless it actually
-- holds exactly total_kobo (0022 BLOCKING 2) — the sharpest possible bug
-- here is releasing money that was never captured; (3) an incorrect
-- delivery code must be rejected (as a normal `code_matched = false`
-- result, not an exception, as of 0025 — see that migration's header)
-- without moving any money or changing order status, and repeated wrong
-- guesses must be rate-limited (0022 SHOULD-FIX 7) since the assigned rider
-- is exactly the adversary this code exists to stop — AND that rate limit
-- must actually be fed by attempts that survive (0025: the pre-0025 insert
-- recording each failed attempt was always rolled back by the exception
-- that used to follow it, so the limit never actually triggered in
-- production); (4) a code-less order must be rejected outright, not
-- silently pass a NULL-vs-NULL comparison (0022 SHOULD-FIX 6); (5)
-- payment_status must be 'paid' (0022 SHOULD-FIX 5); (6) the correct code
-- releases EXACTLY the expected vendor/rider/platform split; (7) the ledger
-- stays balanced (debits = credits) for the escrow_release transaction; (8)
-- a duplicate release call (a network retry) is a no-op, not a second
-- credit.
--
-- throws_ok() calls below use the 4-arg form (sql, sqlstate, exact message,
-- description) — the 2-arg form used in earlier drafts of this file treats
-- the second argument as an expected-message MATCH (pgTAP), not a free-text
-- description, so it silently asserted the wrong thing.
--
-- As of 0025, the function returns `delivery_verification_result`
-- (code_matched boolean, order_row orders) instead of `orders` directly —
-- assertions below that used to read fields straight off the function's
-- return value now address `(r.order_row).<field>` via a `... r` alias in
-- the FROM clause. throws_ok() calls are unaffected (they still assert on
-- exceptions, which are unchanged for every case except the wrong-code one
-- below).

begin;
select plan(14);

select tests.create_supabase_user('customer_a');
select tests.create_supabase_user('vendor_owner_a');
select tests.create_supabase_user('rider_a');
select tests.create_supabase_user('rider_b'); -- not assigned to any order below

insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values ('00000000-0000-7000-8000-000000000050', tests.get_supabase_uid('vendor_owner_a'), 'Test Vendor', 'test-vendor-escrow', 'active', 1500);

insert into riders (user_id, is_online) values
  (tests.get_supabase_uid('rider_a'), true),
  (tests.get_supabase_uid('rider_b'), true);

-- ---------------------------------------------------------------------------
-- Order 051 — the main happy-path fixture. subtotal 500000, delivery_fee
-- 50000, service_fee 10000, discount 0, total 560000, commission_bps 1500
-- (15%): commission = round(500000*0.15) = 75000; vendor = 425000;
-- rider = 50000; platform = 560000 - 425000 - 50000 = 85000.
-- ---------------------------------------------------------------------------

insert into orders (id, customer_id, vendor_id, rider_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location, arrived_at)
values (
  '00000000-0000-7000-8000-000000000051',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000050',
  tests.get_supabase_uid('rider_a'),
  'arrived', 'paid', 500000, 50000, 10000, 0, 560000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)'),
  now() - interval '10 minutes'
);

insert into order_delivery_codes (order_id, code) values ('00000000-0000-7000-8000-000000000051', '4321');

-- Escrow must actually hold total_kobo (0022 BLOCKING 2) — seed a balanced
-- payment_capture pair (gateway debit / escrow credit) as capture_payment()
-- itself would have, rather than assuming the release check will pass.
insert into transactions (id, kind, reference, order_id, description)
values (
  '00000000-0000-7000-8000-000000000151',
  'payment_capture', 'KK-ESCROW-TEST-051', '00000000-0000-7000-8000-000000000051',
  'Test fixture: simulated payment capture for order 051'
);
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '00000000-0000-7000-8000-000000000151', a.id, 'debit', 560000, 'payment_capture', '00000000-0000-7000-8000-000000000051'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway';
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '00000000-0000-7000-8000-000000000151', a.id, 'credit', 560000, 'payment_capture', '00000000-0000-7000-8000-000000000051'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'escrow';

-- rider_b is not the assigned rider on this order — rejected outright, even
-- with the correct code.
select tests.authenticate_as('rider_b');
select throws_ok(
  $$ select verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000051'::uuid, '4321') $$,
  'P0001',
  'verify_delivery_and_release_escrow: actor is not the assigned rider on order 00000000-0000-7000-8000-000000000051',
  'a rider who is not assigned to this order cannot release its escrow'
);

-- rider_a, the assigned rider, but with the wrong code (this also becomes
-- attempt 1/5 for the rate-limit test on a DIFFERENT order below — each
-- order's failed-attempt count is scoped to that order_id, so this doesn't
-- interact with it). As of 0025, this is a normal `code_matched = false`
-- result, not an exception — see that migration's header for why (the old
-- exception-based path silently discarded the rate-limit counter it was
-- supposed to feed).
select tests.authenticate_as('rider_a');
select is(
  (select r.code_matched from verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000051'::uuid, '0000') r),
  false,
  'an incorrect delivery code returns code_matched = false rather than raising (0025)'
);

-- The rejected attempt must not have moved the order out of 'arrived'.
select is(
  (select status from orders where id = '00000000-0000-7000-8000-000000000051'),
  'arrived',
  'a rejected verification attempt does not change the order status'
);

-- The correct code returns code_matched = true, releases escrow, and
-- transitions the order to delivered.
select ok(
  (select r.code_matched and (r.order_row).status = 'delivered'
   from verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000051'::uuid, '4321') r),
  'the correct delivery code returns code_matched = true and transitions the order to delivered'
);

-- account_balances (and the raw ledger_entries/transactions tables below)
-- are revoked from `authenticated` (0024_lock_down_account_balances_view.sql
-- — independent security review, round 3, SHOULD-FIX 9), same as the real
-- vendor-earnings page had to switch to the admin/service-role client for
-- exactly this reason. Verifying these balances is inherently an ops/
-- service-role concern, not something the rider's own identity should need
-- read access to. Found by actually executing this file against real
-- Postgres (permission denied) — never caught by manual review.
select tests.authenticate_as_service_role();

select is(
  (select balance_kobo from account_balances ab join accounts a on a.id = ab.account_id where a.owner_type = 'vendor' and a.owner_id = '00000000-0000-7000-8000-000000000050'),
  425000::bigint,
  'the vendor is credited subtotal minus commission (500000 - 15% = 425000)'
);

select is(
  (select balance_kobo from account_balances ab join accounts a on a.id = ab.account_id where a.owner_type = 'rider' and a.owner_id = tests.get_supabase_uid('rider_a')),
  50000::bigint,
  'the rider is credited exactly the order''s delivery_fee_kobo'
);

select is(
  (select balance_kobo from account_balances ab join accounts a on a.id = ab.account_id where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'revenue'),
  85000::bigint,
  'the platform is credited the residual share (commission + service_fee here, since discount_kobo = 0)'
);

select is(
  (select coalesce(sum(le.amount_kobo) filter (where le.direction = 'debit'), 0) from ledger_entries le join transactions t on t.id = le.transaction_id where t.order_id = '00000000-0000-7000-8000-000000000051' and t.kind = 'escrow_release'),
  (select coalesce(sum(le.amount_kobo) filter (where le.direction = 'credit'), 0) from ledger_entries le join transactions t on t.id = le.transaction_id where t.order_id = '00000000-0000-7000-8000-000000000051' and t.kind = 'escrow_release'),
  'debits equal credits for the escrow_release transaction (the ledger invariant, §9)'
);

-- A duplicate release call (e.g. a network retry after the first call
-- actually succeeded) is a no-op, not a second credit. Must run as the
-- assigned rider again (verify_delivery_and_release_escrow's own actor
-- check requires auth.uid() = rider_id; service_role has no jwt 'sub' claim
-- and would fail that check, which isn't what this assertion is testing).
select tests.authenticate_as('rider_a');
select verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000051'::uuid, '4321');

-- Back to service_role to read ledger_entries directly (revoked from
-- authenticated, same reasoning as the account_balances switch above).
select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from ledger_entries le join transactions t on t.id = le.transaction_id where t.order_id = '00000000-0000-7000-8000-000000000051' and t.kind = 'escrow_release'),
  4,
  'a duplicate release call does not create a second set of ledger entries'
);

-- ---------------------------------------------------------------------------
-- 0022 SHOULD-FIX 5 — payment_status must be 'paid'. Order 059 is 'arrived'
-- but still 'pending' (the default) — release must be refused even though
-- status alone would otherwise allow it.
-- ---------------------------------------------------------------------------

insert into orders (id, customer_id, vendor_id, rider_id, status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location, arrived_at)
values (
  '00000000-0000-7000-8000-000000000059',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000050',
  tests.get_supabase_uid('rider_a'),
  'arrived', 500000, 50000, 10000, 0, 560000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)'),
  now() - interval '10 minutes'
);
insert into order_delivery_codes (order_id, code) values ('00000000-0000-7000-8000-000000000059', '5959');

-- Raw inserts into orders/order_delivery_codes above need service_role
-- (writes are revoked from authenticated, 0007_rls.sql) — but the RPC call
-- itself needs to run as the assigned rider (auth.uid() = rider_id).
select tests.authenticate_as('rider_a');
select throws_ok(
  $$ select verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000059'::uuid, '5959') $$,
  'P0001',
  'verify_delivery_and_release_escrow: order 00000000-0000-7000-8000-000000000059 payment_status is not paid (status=pending)',
  'release is refused when payment_status is not paid, even though status=arrived'
);

-- ---------------------------------------------------------------------------
-- 0022 SHOULD-FIX 6 — a code-less order must be rejected outright, not pass
-- a NULL-vs-NULL comparison. Order 057 is arrived/paid but has no
-- order_delivery_codes row at all.
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
insert into orders (id, customer_id, vendor_id, rider_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location, arrived_at)
values (
  '00000000-0000-7000-8000-000000000057',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000050',
  tests.get_supabase_uid('rider_a'),
  'arrived', 'paid', 500000, 50000, 10000, 0, 560000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)'),
  now() - interval '10 minutes'
);

select tests.authenticate_as('rider_a');
select throws_ok(
  $$ select verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000057'::uuid, null) $$,
  'P0001',
  'verify_delivery_and_release_escrow: no delivery code exists for order 00000000-0000-7000-8000-000000000057',
  'an order with no order_delivery_codes row is rejected outright, never treated as a NULL-vs-NULL pass'
);

-- ---------------------------------------------------------------------------
-- 0022 BLOCKING 2 — escrow must actually hold exactly total_kobo. Order 058
-- is arrived/paid with a correct code, but escrow was only ever credited
-- 400000 kobo against a 560000 total_kobo order (simulating the exact
-- capture_payment() amount-mismatch scenario 0017 allows to still succeed).
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
insert into orders (id, customer_id, vendor_id, rider_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location, arrived_at)
values (
  '00000000-0000-7000-8000-000000000058',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000050',
  tests.get_supabase_uid('rider_a'),
  'arrived', 'paid', 500000, 50000, 10000, 0, 560000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)'),
  now() - interval '10 minutes'
);
insert into order_delivery_codes (order_id, code) values ('00000000-0000-7000-8000-000000000058', '2222');

insert into transactions (id, kind, reference, order_id, description)
values (
  '00000000-0000-7000-8000-000000000152',
  'payment_capture', 'KK-ESCROW-TEST-058', '00000000-0000-7000-8000-000000000058',
  'Test fixture: a shortpaid capture — escrow only holds 400000 of a 560000 total_kobo order'
);
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '00000000-0000-7000-8000-000000000152', a.id, 'debit', 400000, 'payment_capture', '00000000-0000-7000-8000-000000000058'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway';
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '00000000-0000-7000-8000-000000000152', a.id, 'credit', 400000, 'payment_capture', '00000000-0000-7000-8000-000000000058'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'escrow';

select tests.authenticate_as('rider_a');
select throws_ok(
  $$ select verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000058'::uuid, '2222') $$,
  'P0001',
  'verify_delivery_and_release_escrow: escrow for order 00000000-0000-7000-8000-000000000058 holds 400000 kobo but total_kobo is 560000 — refusing to release',
  'release is refused when escrow does not hold exactly total_kobo, even with the correct code'
);

-- ---------------------------------------------------------------------------
-- 0022 SHOULD-FIX 7, made actually effective by 0025 — rate-limit
-- delivery-code guesses. Order 056: 5 wrong guesses are each recorded
-- (as of 0025, `code_matched = false`, not an exception — see that
-- migration's header); a 6th attempt is refused outright by the rate limit,
-- even with the CORRECT code, proving the limit isn't just "5 wrong guesses
-- then unlimited more".
--
-- The DO block below deliberately still wraps each call in its own
-- exception handler — mirroring exactly the pattern that exposed the
-- original bug (a caller that catches every RPC error, the way a real
-- rider-app retry loop would). Under the pre-0025 function, that handler
-- was load-bearing: it caught the 'incorrect delivery code' exception each
-- of the 5 times, and it was precisely that exception's rollback that
-- silently discarded the failed-attempt insert feeding the rate limit,
-- which is why the limit never actually triggered in production. Under the
-- 0025 function, none of these 5 calls raise at all anymore (that's the
-- fix) — the handler is now inert for this path, kept only so this test
-- still faithfully simulates a defensive caller and stays structurally
-- comparable to the pre-fix version of this file. The assertion
-- immediately below is the actual regression test for this bug class: it
-- proves, by querying order_events directly, that all 5 attempts persisted
-- despite having been made from inside that exception-handling wrapper —
-- which is exactly the scenario that used to leave zero rows behind.
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
insert into orders (id, customer_id, vendor_id, rider_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location, arrived_at)
values (
  '00000000-0000-7000-8000-000000000056',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000050',
  tests.get_supabase_uid('rider_a'),
  'arrived', 'paid', 500000, 50000, 10000, 0, 560000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)'),
  now() - interval '10 minutes'
);
insert into order_delivery_codes (order_id, code) values ('00000000-0000-7000-8000-000000000056', '1111');

select tests.authenticate_as('rider_a');
do $$
begin
  for i in 1..5 loop
    begin
      perform verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000056'::uuid, '0000');
    exception when others then
      -- Not expected to trigger under the 0025 function (wrong code no
      -- longer raises) — retained only to mirror the exact caller pattern
      -- that exposed the pre-0025 persistence bug. See this section's
      -- header comment.
      null;
    end;
  end loop;
end;
$$;

-- THE regression test for this bug class: 5 failed attempts made from
-- inside an exception-catching caller must actually be visible afterward.
-- Pre-0025, this count was always 0 regardless of how many wrong guesses
-- happened, because the insert recording each one was rolled back by the
-- exception that used to immediately follow it in the same transaction.
select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from order_events where order_id = '00000000-0000-7000-8000-000000000056' and (meta ->> 'delivery_code_failed')::boolean is true),
  5,
  'all 5 failed delivery-code attempts persist, including when made from inside a caller that catches exceptions (0025 regression test)'
);

select tests.authenticate_as('rider_a');
select throws_ok(
  $$ select verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000056'::uuid, '1111') $$,
  'P0001',
  'verify_delivery_and_release_escrow: too many incorrect delivery-code attempts for order 00000000-0000-7000-8000-000000000056',
  'a 6th attempt is refused by the rate limit even with the correct code, after 5 prior wrong guesses'
);

select * from finish();
rollback;
