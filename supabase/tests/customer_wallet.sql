-- pgTAP: the customer wallet (0045_customer_wallet.sql). Same caveat as every
-- other file in this directory: not executed here (no Docker/Supabase CLI in
-- this environment), run via `supabase test db` or CI's `pgtap` job.
--
-- What this protects, in order of how bad getting it wrong would be:
-- (1) A WALLET CAN NEVER BE OVERDRAWN. Balances are derived, not stored
--     (0005_ledger.sql), so nothing structural stopped two spends from
--     honouring the same naira twice. Both lines of defence are tested
--     independently: pay_order_from_wallet()'s own balance check, and the
--     ledger_entries_wallet_not_negative constraint trigger, which must
--     reject a raw over-debit even when written directly as service_role.
-- (2) One order can only be funded once. A second pay_order_from_wallet()
--     call for the same order must not produce a second escrow credit.
-- (3) A customer can only ever spend THEIR OWN wallet, on THEIR OWN order,
--     and can only ever read their own balance.
-- (4) A cancelled/rejected order's escrow lands in the customer's wallet
--     rather than back at the gateway — with the ledger still balanced.
-- (5) The admin card-refund path ('gateway') still behaves exactly as it did
--     before this migration, so "refund it to my card instead" stays real.
--
-- throws_ok() calls below use the 4-arg form (sql, sqlstate, exact message,
-- description) — the 2-arg form treats the second argument as an expected-
-- message MATCH (pgTAP), not a free-text description (see this repo's other
-- test files' own header notes on this). Where an error message embeds a
-- generated uuid or a computed amount, `null` is passed as the expected
-- message and the SQLSTATE carries the assertion.

begin;
select plan(23);

select tests.create_supabase_user('wallet_customer');
select tests.create_supabase_user('wallet_other_customer');
select tests.create_supabase_user('wallet_vendor_owner');
select tests.create_supabase_user('wallet_admin');

insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values ('00000000-0000-7000-8000-000000000090', tests.get_supabase_uid('wallet_vendor_owner'), 'Wallet Test Vendor', 'wallet-test-vendor', 'active', 1500);

insert into user_roles (user_id, role) values (tests.get_supabase_uid('wallet_admin'), 'admin');

-- ---------------------------------------------------------------------------
-- Fixtures.
--
-- Order 090 — captured and sitting at 'accepted'. Cancelling it is what
-- funds the wallet under test, so every later assertion traces back to real
-- money that really was in escrow, not a hand-inserted balance.
-- total = 80000 + 15000 + 5000 = 100000 kobo.
-- ---------------------------------------------------------------------------

insert into orders (id, customer_id, vendor_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000090',
  tests.get_supabase_uid('wallet_customer'),
  '00000000-0000-7000-8000-000000000090',
  'accepted', 'paid', 80000, 15000, 5000, 0, 100000,
  '{"line1": "1 Wallet Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);

insert into transactions (id, kind, reference, order_id, description)
values (
  '00000000-0000-7000-8000-000000000190',
  'payment_capture', 'KK-WALLET-TEST-090', '00000000-0000-7000-8000-000000000090',
  'Test fixture: simulated payment capture for order 090'
);

insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select
  '00000000-0000-7000-8000-000000000190',
  a.id,
  case when a.kind = 'gateway' then 'debit' else 'credit' end,
  100000,
  'payment_capture',
  '00000000-0000-7000-8000-000000000090'
from accounts a
where a.owner_type = 'platform' and a.owner_id is null and a.kind in ('gateway', 'escrow');

-- Order 091 — a fresh draft for the same customer, costing 60000. This is
-- what the wallet will actually be spent on.
insert into orders (id, customer_id, vendor_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000091',
  tests.get_supabase_uid('wallet_customer'),
  '00000000-0000-7000-8000-000000000090',
  'draft', 'pending', 50000, 8000, 2000, 0, 60000,
  '{"line1": "1 Wallet Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);

-- Order 092 — a draft costing more than the wallet will ever hold (200000),
-- for the insufficient-balance case.
insert into orders (id, customer_id, vendor_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000092',
  tests.get_supabase_uid('wallet_customer'),
  '00000000-0000-7000-8000-000000000090',
  'draft', 'pending', 180000, 15000, 5000, 0, 200000,
  '{"line1": "1 Wallet Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);

-- Order 093 — belongs to a DIFFERENT customer, used to prove one customer
-- cannot fund another's order from their own balance.
insert into orders (id, customer_id, vendor_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000093',
  tests.get_supabase_uid('wallet_other_customer'),
  '00000000-0000-7000-8000-000000000090',
  'draft', 'pending', 8000, 1000, 1000, 0, 10000,
  '{"line1": "2 Wallet Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);

-- Order 094 — captured and accepted like 090, reserved for the admin
-- 'gateway' (card) refund path.
insert into orders (id, customer_id, vendor_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000094',
  tests.get_supabase_uid('wallet_customer'),
  '00000000-0000-7000-8000-000000000090',
  'accepted', 'paid', 30000, 5000, 5000, 0, 40000,
  '{"line1": "1 Wallet Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);

insert into transactions (id, kind, reference, order_id, description)
values (
  '00000000-0000-7000-8000-000000000194',
  'payment_capture', 'KK-WALLET-TEST-094', '00000000-0000-7000-8000-000000000094',
  'Test fixture: simulated payment capture for order 094'
);

insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select
  '00000000-0000-7000-8000-000000000194',
  a.id,
  case when a.kind = 'gateway' then 'debit' else 'credit' end,
  40000,
  'payment_capture',
  '00000000-0000-7000-8000-000000000094'
from accounts a
where a.owner_type = 'platform' and a.owner_id is null and a.kind in ('gateway', 'escrow');

-- ---------------------------------------------------------------------------
-- 1. Cancelling a captured order credits the CUSTOMER'S WALLET.
--    This is the whole point of the migration: before it, this same
--    transition credited platform:gateway and left the customer waiting on a
--    Monnify card refund.
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

select lives_ok(
  $$ select transition_order(
       '00000000-0000-7000-8000-000000000090'::uuid, 'cancelled_by_platform', 'system', null, '{}'::jsonb
     ) $$,
  'cancelling a captured order succeeds'
);

select is(
  (select balance_kobo from account_balances b
     join accounts a on a.id = b.account_id
    where a.owner_type = 'customer' and a.owner_id = tests.get_supabase_uid('wallet_customer') and a.kind = 'wallet'),
  100000::bigint,
  'the cancelled order''s full captured amount lands in the customer''s wallet'
);

select is(
  (select count(*)::int from ledger_entries e
     join accounts a on a.id = e.account_id
    where e.order_id = '00000000-0000-7000-8000-000000000090'
      and e.entry_type = 'refund'
      and a.owner_type = 'platform' and a.kind = 'gateway'),
  0,
  'a wallet refund writes NO credit back to platform:gateway — the money never leaves the platform'
);

-- The ledger invariant is enforced by trigger, but assert it explicitly for
-- the refund transaction: a wallet credit must be matched by an escrow debit.
select is(
  (select coalesce(sum(case when e.direction = 'credit' then e.amount_kobo else -e.amount_kobo end), 0)
     from ledger_entries e
     join transactions t on t.id = e.transaction_id
    where t.order_id = '00000000-0000-7000-8000-000000000090' and t.kind = 'refund'),
  0::bigint,
  'the refund transaction is internally balanced (debits = credits)'
);

select is(
  (select payment_status from orders where id = '00000000-0000-7000-8000-000000000090'),
  'refunded',
  'the refunded order is marked payment_status = refunded'
);

-- ---------------------------------------------------------------------------
-- 2. Reading a balance is scoped to the caller, with no argument that could
--    point it at anybody else.
-- ---------------------------------------------------------------------------

select tests.clear_authentication();

select throws_ok(
  $$ select get_wallet_balance() $$,
  '42501',
  null,
  'get_wallet_balance() refuses an unauthenticated caller'
);

select tests.authenticate_as('wallet_customer');

select is(
  (select get_wallet_balance()),
  100000::bigint,
  'the customer reads their own refunded balance'
);

select tests.authenticate_as('wallet_other_customer');

select is(
  (select get_wallet_balance()),
  0::bigint,
  'a different customer sees zero — wallets are not readable across accounts'
);

-- A customer must not be able to fund someone else's order from their own
-- balance, nor anyone else's order at all.
select throws_ok(
  $$ select pay_order_from_wallet('00000000-0000-7000-8000-000000000091'::uuid) $$,
  '42501',
  null,
  'a customer cannot pay an order that is not theirs'
);

-- ---------------------------------------------------------------------------
-- 3. Spending the wallet.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('wallet_customer');

select throws_ok(
  $$ select pay_order_from_wallet('00000000-0000-7000-8000-000000000092'::uuid) $$,
  '23514',
  null,
  'an order costing more than the wallet holds is refused'
);

select is(
  (select get_wallet_balance()),
  100000::bigint,
  'a refused payment leaves the balance untouched'
);

select lives_ok(
  $$ select pay_order_from_wallet('00000000-0000-7000-8000-000000000091'::uuid) $$,
  'an order within the wallet balance is paid'
);

select is(
  (select get_wallet_balance()),
  40000::bigint,
  'the order total is debited from the wallet (100000 - 60000)'
);

select is(
  (select status from orders where id = '00000000-0000-7000-8000-000000000091'),
  'placed',
  'a wallet-paid order moves draft -> placed, exactly as a card capture does'
);

select is(
  (select payment_method from orders where id = '00000000-0000-7000-8000-000000000091'),
  'wallet',
  'the order records how it was funded'
);

select is(
  (select coalesce(sum(e.amount_kobo), 0) from ledger_entries e
     join accounts a on a.id = e.account_id
    where e.order_id = '00000000-0000-7000-8000-000000000091'
      and a.owner_type = 'platform' and a.kind = 'escrow'
      and e.direction = 'credit'),
  60000::bigint,
  'the money moved into escrow, so the rest of the order lifecycle is unchanged'
);

-- Paying the same order twice must not produce a second escrow credit. The
-- order is no longer draft/pending, which is the guard that catches it.
select throws_ok(
  $$ select pay_order_from_wallet('00000000-0000-7000-8000-000000000091'::uuid) $$,
  '23514',
  null,
  'a second payment for the same order is refused'
);

select is(
  (select get_wallet_balance()),
  40000::bigint,
  'the refused second payment did not debit the wallet again'
);

-- ---------------------------------------------------------------------------
-- 4. The structural backstop. Even service_role, writing ledger entries by
--    hand and bypassing pay_order_from_wallet() entirely, cannot overdraw a
--    wallet — the constraint trigger rejects the transaction at COMMIT.
-- ---------------------------------------------------------------------------

select tests.clear_authentication();
select tests.authenticate_as_service_role();

select throws_ok(
  $$
  do $inner$
  declare
    v_wallet_id uuid;
    v_escrow_id uuid;
    v_txn_id    uuid;
  begin
    select id into v_wallet_id from accounts
     where owner_type = 'customer' and owner_id = tests.get_supabase_uid('wallet_customer') and kind = 'wallet';
    select id into v_escrow_id from accounts
     where owner_type = 'platform' and owner_id is null and kind = 'escrow';

    insert into transactions (kind, reference, description)
    values ('adjustment', 'KK-WALLET-OVERDRAW-ATTEMPT', 'Test: deliberate overdraw')
    returning id into v_txn_id;

    -- 999999 kobo against a wallet holding 40000. Balanced as a transaction,
    -- so the ledger invariant itself is satisfied — only the wallet guard
    -- can catch this one.
    insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type)
    values
      (v_txn_id, v_wallet_id, 'debit', 999999, 'adjustment'),
      (v_txn_id, v_escrow_id, 'credit', 999999, 'adjustment');

    -- ledger_entries_wallet_not_negative is DEFERRABLE INITIALLY DEFERRED
    -- (deliberately — see 0045), so it would otherwise only fire at COMMIT,
    -- which this file never reaches. Forcing it here is what makes the guard
    -- observable to the assertion around this block.
    set constraints all immediate;
  end
  $inner$;
  $$,
  '23514',
  null,
  'the constraint trigger rejects a hand-written over-debit, even as service_role'
);

select is(
  (select balance_kobo from account_balances b
     join accounts a on a.id = b.account_id
    where a.owner_type = 'customer' and a.owner_id = tests.get_supabase_uid('wallet_customer') and a.kind = 'wallet'),
  40000::bigint,
  'the wallet balance survived the overdraw attempt intact'
);

-- ---------------------------------------------------------------------------
-- 5. The card-refund escape hatch still works. "Wallet by default, back to
--    the card on request" is only true if 'gateway' still does the old thing.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select refund_order_escrow(
       '00000000-0000-7000-8000-000000000094'::uuid,
       tests.get_supabase_uid('wallet_admin'),
       'Customer asked for it back on their card',
       'gateway'
     ) $$,
  'an admin can refund to the gateway instead of the wallet'
);

select is(
  (select coalesce(sum(e.amount_kobo), 0) from ledger_entries e
     join accounts a on a.id = e.account_id
    where e.order_id = '00000000-0000-7000-8000-000000000094'
      and e.entry_type = 'refund'
      and e.direction = 'credit'
      and a.owner_type = 'platform' and a.kind = 'gateway'),
  40000::bigint,
  'a gateway refund credits platform:gateway, exactly as it did before the wallet existed'
);

select tests.clear_authentication();
select tests.authenticate_as('wallet_customer');

select is(
  (select get_wallet_balance()),
  40000::bigint,
  'a gateway refund adds nothing to the wallet'
);

select * from finish();
rollback;
