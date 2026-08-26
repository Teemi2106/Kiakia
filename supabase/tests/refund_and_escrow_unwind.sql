-- pgTAP: refund_order_escrow() and admin_reset_delivery_code_attempts()
-- (0031_refund_and_escrow_unwind.sql) — the two money-unstranding RPCs this
-- migration adds. Same caveat as every other file in this directory: not
-- executed here (no Docker/Supabase CLI in this environment), run via
-- `supabase test db` or CI's `pgtap` job.
--
-- What this protects, in order of how bad getting it wrong would be:
-- (1) refund_order_escrow() must NEVER succeed once an order's escrow has
--     already been released — that would pay the platform out twice for
--     money it no longer holds. This is the single most important guard in
--     that function.
-- (2) a refund leaves the ledger balanced (debits = credits) for the
--     refund transaction.
-- (3) a duplicate refund call is idempotent — a no-op, not a second credit.
-- (4) a refund of an order that is ALREADY in a terminal, never-released
--     status (the exact "captured then cancelled with no ledger reversal"
--     bug this migration exists to fix) reverses the ledger without forcing
--     an invented status transition.
-- (5) neither RPC is reachable by a non-admin or a non-service-role caller.
-- (6) admin_reset_delivery_code_attempts() genuinely re-enables
--     verify_delivery_and_release_escrow() for an order that hit the 5-wrong-
--     guess lockout, and refuses for an order that isn't 'arrived'.
--
-- throws_ok() calls below use the 4-arg form (sql, sqlstate, exact message,
-- description) — the 2-arg form treats the second argument as an expected-
-- message MATCH (pgTAP), not a free-text description (see this repo's other
-- test files' own header notes on this).

begin;
select plan(17);

select tests.create_supabase_user('customer_a');
select tests.create_supabase_user('vendor_owner_a');
select tests.create_supabase_user('rider_a');
select tests.create_supabase_user('admin_a');

insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values ('00000000-0000-7000-8000-000000000070', tests.get_supabase_uid('vendor_owner_a'), 'Test Vendor', 'test-vendor-refund', 'active', 1500);

insert into riders (user_id, is_online) values (tests.get_supabase_uid('rider_a'), true);

-- admin_a is a real admin — refund_order_escrow/admin_reset_delivery_code_attempts
-- verify p_actor_id against this row, same predicate as approve_vendor/reject_vendor
-- (0021_admin_vendor_approval.sql).
insert into user_roles (user_id, role) values (tests.get_supabase_uid('admin_a'), 'admin');

-- ---------------------------------------------------------------------------
-- Order 070 — the happy-path fixture: captured (escrow funded) but never
-- released, still sitting at 'accepted' (an active, legal-edge-to-
-- cancelled_by_platform status). subtotal 80000 + delivery_fee 15000 +
-- service_fee 5000 - discount 0 = total 100000.
-- ---------------------------------------------------------------------------

insert into orders (id, customer_id, vendor_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000070',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000070',
  'accepted', 'paid', 80000, 15000, 5000, 0, 100000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);

insert into transactions (id, kind, reference, order_id, description)
values (
  '00000000-0000-7000-8000-000000000170',
  'payment_capture', 'KK-REFUND-TEST-070', '00000000-0000-7000-8000-000000000070',
  'Test fixture: simulated payment capture for order 070'
);
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '00000000-0000-7000-8000-000000000170', a.id, 'debit', 100000, 'payment_capture', '00000000-0000-7000-8000-000000000070'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway';
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '00000000-0000-7000-8000-000000000170', a.id, 'credit', 100000, 'payment_capture', '00000000-0000-7000-8000-000000000070'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'escrow';

-- A plain authenticated (non-service-role) session cannot call this at all,
-- regardless of who p_actor_id claims to be.
select tests.authenticate_as('customer_a');
select throws_ok(
  format(
    $$ select refund_order_escrow('00000000-0000-7000-8000-000000000070'::uuid, %L::uuid, 'test refund') $$,
    tests.get_supabase_uid('admin_a')
  ),
  'P0001',
  'refund_order_escrow: requires the service-role key',
  'a plain authenticated session cannot call refund_order_escrow, even claiming a real admin''s uid'
);

-- service_role, but p_actor_id is not an admin — refused.
select tests.authenticate_as_service_role();
select throws_ok(
  format(
    $$ select refund_order_escrow('00000000-0000-7000-8000-000000000070'::uuid, %L::uuid, 'test refund') $$,
    tests.get_supabase_uid('customer_a')
  ),
  'P0001',
  format('refund_order_escrow: actor %s is not an admin', tests.get_supabase_uid('customer_a')),
  'service_role callers still need a real admin/superadmin user_roles row for p_actor_id'
);

-- The real thing: service_role + a genuine admin actor.
select refund_order_escrow('00000000-0000-7000-8000-000000000070'::uuid, tests.get_supabase_uid('admin_a'), 'test refund reason');

select is(
  (select coalesce(sum(le.amount_kobo) filter (where le.direction = 'debit'), 0) from ledger_entries le join transactions t on t.id = le.transaction_id where t.order_id = '00000000-0000-7000-8000-000000000070' and t.kind = 'refund'),
  (select coalesce(sum(le.amount_kobo) filter (where le.direction = 'credit'), 0) from ledger_entries le join transactions t on t.id = le.transaction_id where t.order_id = '00000000-0000-7000-8000-000000000070' and t.kind = 'refund'),
  'the refund transaction is balanced (debits = credits, the ledger invariant)'
);

select is(
  (select amount_kobo from ledger_entries le join transactions t on t.id = le.transaction_id join accounts a on a.id = le.account_id where t.order_id = '00000000-0000-7000-8000-000000000070' and t.kind = 'refund' and a.kind = 'escrow' and le.direction = 'debit'),
  100000::bigint,
  'the refund debits escrow for exactly what was captured (derived from the ledger, not total_kobo or a caller-supplied amount)'
);

select is(
  (select status::text from orders where id = '00000000-0000-7000-8000-000000000070'),
  'cancelled_by_platform',
  'a refund of an order still in an active status transitions it to cancelled_by_platform (a legal edge from accepted)'
);

select is(
  (select payment_status from orders where id = '00000000-0000-7000-8000-000000000070'),
  'refunded',
  'a refunded order''s payment_status becomes refunded'
);

select is(
  (select count(*)::int from order_events where order_id = '00000000-0000-7000-8000-000000000070' and (meta ->> 'reason') = 'test refund reason'),
  1,
  'the refund reason is recorded on order_events.meta'
);

-- Idempotent: a retried refund call is a no-op, not a second credit.
select refund_order_escrow('00000000-0000-7000-8000-000000000070'::uuid, tests.get_supabase_uid('admin_a'), 'test refund reason');
select is(
  (select count(*)::int from ledger_entries le join transactions t on t.id = le.transaction_id where t.order_id = '00000000-0000-7000-8000-000000000070' and t.kind = 'refund'),
  2,
  'a duplicate refund call does not create a second set of ledger entries'
);

-- ---------------------------------------------------------------------------
-- Order 071 — the single most important guard: escrow already released via
-- the real verify_delivery_and_release_escrow() path must refuse a refund
-- outright, never pay out AND refund the same order.
-- ---------------------------------------------------------------------------

insert into orders (id, customer_id, vendor_id, rider_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location, arrived_at)
values (
  '00000000-0000-7000-8000-000000000071',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000070',
  tests.get_supabase_uid('rider_a'),
  'arrived', 'paid', 80000, 15000, 5000, 0, 100000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)'),
  now() - interval '10 minutes'
);
insert into order_delivery_codes (order_id, code) values ('00000000-0000-7000-8000-000000000071', '7171');

insert into transactions (id, kind, reference, order_id, description)
values (
  '00000000-0000-7000-8000-000000000171',
  'payment_capture', 'KK-REFUND-TEST-071', '00000000-0000-7000-8000-000000000071',
  'Test fixture: simulated payment capture for order 071'
);
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '00000000-0000-7000-8000-000000000171', a.id, 'debit', 100000, 'payment_capture', '00000000-0000-7000-8000-000000000071'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway';
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '00000000-0000-7000-8000-000000000171', a.id, 'credit', 100000, 'payment_capture', '00000000-0000-7000-8000-000000000071'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'escrow';

-- Genuinely release escrow via the real function, so the escrow-release
-- reference this test relies on is exactly what refund_order_escrow() would
-- see in production — not faked to match orders.code, which is
-- sequence-assigned and not something this test controls.
select tests.authenticate_as('rider_a');
select verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000071'::uuid, '7171');

select tests.authenticate_as_service_role();
select throws_ok(
  $$ select refund_order_escrow('00000000-0000-7000-8000-000000000071'::uuid, tests.get_supabase_uid('admin_a'), 'too late') $$,
  'P0001',
  'refund_order_escrow: order 00000000-0000-7000-8000-000000000071 escrow has already been released to vendor/rider/platform — refusing to refund and pay out twice',
  'refund_order_escrow refuses outright once escrow has actually been released — the single most important guard'
);

-- ---------------------------------------------------------------------------
-- Order 072 — captured then already cancelled_by_platform with NO ledger
-- reversal ever having happened: exactly the money-stranding bug (a) this
-- migration exists to fix. cancelled_by_platform has no outbound edge in
-- order_status_transitions (0006), so refund_order_escrow must reverse the
-- ledger WITHOUT forcing an invented transition — the order's status stays
-- exactly what it already was.
-- ---------------------------------------------------------------------------

insert into orders (id, customer_id, vendor_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location, cancelled_at)
values (
  '00000000-0000-7000-8000-000000000072',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000070',
  'cancelled_by_platform', 'paid', 80000, 15000, 5000, 0, 100000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)'),
  now() - interval '1 hour'
);

insert into transactions (id, kind, reference, order_id, description)
values (
  '00000000-0000-7000-8000-000000000172',
  'payment_capture', 'KK-REFUND-TEST-072', '00000000-0000-7000-8000-000000000072',
  'Test fixture: simulated payment capture for order 072, cancelled with no refund ever issued'
);
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '00000000-0000-7000-8000-000000000172', a.id, 'debit', 100000, 'payment_capture', '00000000-0000-7000-8000-000000000072'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway';
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '00000000-0000-7000-8000-000000000172', a.id, 'credit', 100000, 'payment_capture', '00000000-0000-7000-8000-000000000072'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'escrow';

select refund_order_escrow('00000000-0000-7000-8000-000000000072'::uuid, tests.get_supabase_uid('admin_a'), 'already cancelled, unwinding stranded escrow');

select is(
  (select coalesce(sum(le.amount_kobo) filter (where le.direction = 'debit'), 0) from ledger_entries le join transactions t on t.id = le.transaction_id where t.order_id = '00000000-0000-7000-8000-000000000072' and t.kind = 'refund'),
  (select coalesce(sum(le.amount_kobo) filter (where le.direction = 'credit'), 0) from ledger_entries le join transactions t on t.id = le.transaction_id where t.order_id = '00000000-0000-7000-8000-000000000072' and t.kind = 'refund'),
  'refunding an already-terminal order still leaves a balanced ledger'
);

select is(
  (select status::text from orders where id = '00000000-0000-7000-8000-000000000072'),
  'cancelled_by_platform',
  'refunding an order with no legal outbound edge does not force an invented status transition — status is unchanged'
);

select is(
  (select count(*)::int from order_events where order_id = '00000000-0000-7000-8000-000000000072' and (meta ->> 'escrow_refunded')::boolean is true),
  1,
  'the refund is still recorded on order_events even when no status transition occurs'
);

-- ---------------------------------------------------------------------------
-- admin_reset_delivery_code_attempts() — authorization mirrors
-- refund_order_escrow() exactly.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('customer_a');
select throws_ok(
  format(
    $$ select admin_reset_delivery_code_attempts('00000000-0000-7000-8000-000000000071'::uuid, %L::uuid) $$,
    tests.get_supabase_uid('admin_a')
  ),
  'P0001',
  'admin_reset_delivery_code_attempts: requires the service-role key',
  'a plain authenticated session cannot call admin_reset_delivery_code_attempts'
);

select tests.authenticate_as_service_role();
select throws_ok(
  format(
    $$ select admin_reset_delivery_code_attempts('00000000-0000-7000-8000-000000000071'::uuid, %L::uuid) $$,
    tests.get_supabase_uid('customer_a')
  ),
  'P0001',
  format('admin_reset_delivery_code_attempts: actor %s is not an admin', tests.get_supabase_uid('customer_a')),
  'service_role callers still need a real admin/superadmin user_roles row for p_actor_id'
);

-- Order 074 — a real admin, but the order isn't 'arrived' (still 'accepted'
-- from order 070's original status re-used conceptually) — refused, since
-- the rate limit only ever matters for an order awaiting code verification.
insert into orders (id, customer_id, vendor_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000074',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000070',
  'accepted', 'paid', 80000, 15000, 5000, 0, 100000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);
select throws_ok(
  format(
    $$ select admin_reset_delivery_code_attempts('00000000-0000-7000-8000-000000000074'::uuid, %L::uuid) $$,
    tests.get_supabase_uid('admin_a')
  ),
  'P0001',
  'admin_reset_delivery_code_attempts: order 00000000-0000-7000-8000-000000000074 is not awaiting delivery-code verification (status=accepted)',
  'admin_reset_delivery_code_attempts refuses an order that is not arrived'
);

-- ---------------------------------------------------------------------------
-- Order 073 — the full lockout-then-recovery flow: 5 wrong guesses trip the
-- rate limit (0022/0025), an admin reset genuinely re-opens the window, and
-- the correct code then succeeds — proving this is a real fix, not just a
-- function that runs without erroring.
--
-- Note on why 0031's redefined verify_delivery_and_release_escrow() compares
-- the reset marker with a STRICT `>` rather than `>=`: this entire script
-- runs inside one wrapping `begin ... rollback` transaction, and `now()` is
-- transaction_timestamp() in Postgres — constant for the whole transaction,
-- not real wall-clock time. Every order_events row inserted below (the 5
-- failed attempts AND the admin-reset marker) therefore shares the exact
-- same `at` value. A `>=` comparison against the reset marker would still
-- count the 5 pre-reset failures as "at or after the reset" and the
-- recovery assertion below would incorrectly still hit the rate limit. This
-- is purely a test-harness artifact — in real production every RPC call is
-- its own transaction (0025's own header note), so a failed attempt and a
-- subsequent reset can never genuinely tie — but the strict `>` is what
-- makes this scenario actually exercisable inside a single pgTAP
-- transaction, which is why 0031 chose it deliberately rather than folding
-- the reset marker into the same `>=` bound arrived_at already uses.
-- ---------------------------------------------------------------------------

insert into orders (id, customer_id, vendor_id, rider_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location, arrived_at)
values (
  '00000000-0000-7000-8000-000000000073',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000070',
  tests.get_supabase_uid('rider_a'),
  'arrived', 'paid', 80000, 15000, 5000, 0, 100000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)'),
  now() - interval '10 minutes'
);
insert into order_delivery_codes (order_id, code) values ('00000000-0000-7000-8000-000000000073', '7373');

insert into transactions (id, kind, reference, order_id, description)
values (
  '00000000-0000-7000-8000-000000000173',
  'payment_capture', 'KK-REFUND-TEST-073', '00000000-0000-7000-8000-000000000073',
  'Test fixture: simulated payment capture for order 073'
);
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '00000000-0000-7000-8000-000000000173', a.id, 'debit', 100000, 'payment_capture', '00000000-0000-7000-8000-000000000073'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway';
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '00000000-0000-7000-8000-000000000173', a.id, 'credit', 100000, 'payment_capture', '00000000-0000-7000-8000-000000000073'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'escrow';

select tests.authenticate_as('rider_a');
do $$
begin
  for i in 1..5 loop
    perform verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000073'::uuid, '0000');
  end loop;
end;
$$;

select throws_ok(
  $$ select verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000073'::uuid, '7373') $$,
  'P0001',
  'verify_delivery_and_release_escrow: too many incorrect delivery-code attempts for order 00000000-0000-7000-8000-000000000073',
  'the correct code is still refused after 5 wrong guesses trip the rate limit'
);

select tests.authenticate_as_service_role();
select admin_reset_delivery_code_attempts('00000000-0000-7000-8000-000000000073'::uuid, tests.get_supabase_uid('admin_a'));

select tests.authenticate_as('rider_a');
select ok(
  (select r.code_matched and (r.order_row).status = 'delivered'
   from verify_delivery_and_release_escrow('00000000-0000-7000-8000-000000000073'::uuid, '7373') r),
  'after an admin reset, the correct code succeeds again — the reset genuinely re-enables verify_delivery_and_release_escrow()'
);

select * from finish();
rollback;
