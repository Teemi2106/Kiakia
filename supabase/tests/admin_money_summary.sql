-- pgTAP: admin_money_summary (0091_admin_money_summary.sql).
--
-- What this protects, in order of how bad getting it wrong would be:
-- (1) service_role ONLY: the owner's money totals must never be readable with a
--     user JWT, even an admin's (PostgREST exposes anything granted to
--     authenticated).
-- (2) Every figure is derived from the ledger exactly as defined in the
--     migration header. A seeded lifecycle pins each one: a delivered order with
--     the known split (5000 subtotal + 800 delivery + 100 service = 5900 ->
--     vendor 4250, rider 800, platform 850 at 15%), a card refund to the wallet,
--     a card refund to the gateway, a wallet-funded order still in escrow, a
--     short card payment credited to the wallet, a vendor payout, and an order
--     delivered OUTSIDE the window.
-- (3) The window filter applies to flows and NOT to point-in-time figures.
-- (4) The reconciliation block says true on a consistent ledger and false (with
--     the exact difference) when money appears in escrow without a capture.
--
-- The database may already hold ledger rows, so every all-time figure is
-- asserted as a DELTA from a baseline taken before seeding, and the windowed
-- figures use a January 2032 window nothing else uses.

begin;
select plan(36);

create temp table base as select admin_money_summary() as j;
create temp table win_base as select admin_money_summary('2032-01-01', '2032-02-01') as j;
grant all on base, win_base to public;

-- Fixture accounts (owner ids are arbitrary uuids: accounts.owner_id has no FK).
insert into accounts (owner_type, owner_id, kind) values
  ('vendor', 'ee000000-0000-7000-8000-000000000001', 'available'),
  ('rider', 'ee000000-0000-7000-8000-000000000002', 'available'),
  ('customer', 'ee000000-0000-7000-8000-000000000003', 'wallet');

create temp table fx (ref text, owner_type text, kind text, owner_id uuid, dir text, amt bigint, etype text, at timestamptz);
insert into fx values
  -- A: card order, delivered 6 Jan inside the window. 5000 + 800 + 100 = 5900.
  ('A-cap',  'platform', 'gateway',   null, 'debit',  5900, 'payment_capture', '2032-01-05'),
  ('A-cap',  'platform', 'escrow',    null, 'credit', 5900, 'payment_capture', '2032-01-05'),
  ('A-rel',  'platform', 'escrow',    null, 'debit',  5900, 'escrow_release',  '2032-01-06'),
  ('A-rel',  'vendor',   'available', 'ee000000-0000-7000-8000-000000000001', 'credit', 4250, 'escrow_release', '2032-01-06'),
  ('A-rel',  'rider',    'available', 'ee000000-0000-7000-8000-000000000002', 'credit',  800, 'escrow_release', '2032-01-06'),
  ('A-rel',  'platform', 'revenue',   null, 'credit',  850, 'escrow_release',  '2032-01-06'),
  -- C: card order 3000, cancelled, refunded to the customer's wallet.
  ('C-cap',  'platform', 'gateway',   null, 'debit',  3000, 'payment_capture', '2032-01-10'),
  ('C-cap',  'platform', 'escrow',    null, 'credit', 3000, 'payment_capture', '2032-01-10'),
  ('C-ref',  'platform', 'escrow',    null, 'debit',  3000, 'refund',          '2032-01-11'),
  ('C-ref',  'customer', 'wallet', 'ee000000-0000-7000-8000-000000000003', 'credit', 3000, 'refund', '2032-01-11'),
  -- B: wallet-funded order 2000, still held in escrow (in progress).
  ('B-cap',  'customer', 'wallet', 'ee000000-0000-7000-8000-000000000003', 'debit', 2000, 'payment_capture', '2032-01-12'),
  ('B-cap',  'platform', 'escrow',    null, 'credit', 2000, 'payment_capture', '2032-01-12'),
  -- D: card order 1000, refunded to the card (gateway).
  ('D-cap',  'platform', 'gateway',   null, 'debit',  1000, 'payment_capture', '2032-01-15'),
  ('D-cap',  'platform', 'escrow',    null, 'credit', 1000, 'payment_capture', '2032-01-15'),
  ('D-ref',  'platform', 'escrow',    null, 'debit',  1000, 'refund',          '2032-01-16'),
  ('D-ref',  'platform', 'gateway',   null, 'credit', 1000, 'refund',          '2032-01-16'),
  -- U: short card payment of 400 credited to the wallet (never touches escrow).
  ('U-ref',  'platform', 'gateway',   null, 'debit',   400, 'refund',          '2032-01-18'),
  ('U-ref',  'customer', 'wallet', 'ee000000-0000-7000-8000-000000000003', 'credit', 400, 'refund', '2032-01-18'),
  -- Payout of 1000 to the vendor on 20 Jan.
  ('P-1',    'vendor',   'available', 'ee000000-0000-7000-8000-000000000001', 'debit', 1000, 'payout', '2032-01-20'),
  ('P-1',    'platform', 'gateway',   null, 'credit', 1000, 'payout',          '2032-01-20'),
  -- E: card order 1000 captured AND delivered in March, outside the window. 700 / 200 / 100.
  ('E-cap',  'platform', 'gateway',   null, 'debit',  1000, 'payment_capture', '2032-03-05'),
  ('E-cap',  'platform', 'escrow',    null, 'credit', 1000, 'payment_capture', '2032-03-05'),
  ('E-rel',  'platform', 'escrow',    null, 'debit',  1000, 'escrow_release',  '2032-03-06'),
  ('E-rel',  'vendor',   'available', 'ee000000-0000-7000-8000-000000000001', 'credit',  700, 'escrow_release', '2032-03-06'),
  ('E-rel',  'rider',    'available', 'ee000000-0000-7000-8000-000000000002', 'credit',  200, 'escrow_release', '2032-03-06'),
  ('E-rel',  'platform', 'revenue',   null, 'credit',  100, 'escrow_release',  '2032-03-06');

insert into transactions (kind, reference, description)
select case when ref like '%-rel' then 'escrow_release'
            when ref like '%-cap' then 'payment_capture'
            when ref like 'P-%' then 'payout'
            else 'refund' end,
       'MS-' || ref, 'fixture'
from (select distinct ref from fx) r;

insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, created_at)
select t.id, a.id, f.dir, f.amt, f.etype, f.at
from fx f
join transactions t on t.reference = 'MS-' || f.ref
join accounts a on a.owner_type = f.owner_type and a.kind = f.kind and a.owner_id is not distinct from f.owner_id;

create temp table jan as select admin_money_summary('2032-01-01', '2032-02-01') as j;
create temp table alltime as select admin_money_summary() as j;
grant all on jan, alltime to public;

-- ---------------------------------------------------------------------------
-- (1) Who may call.
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('ms_admin');
select tests.clear_authentication();
select throws_ok($$ select admin_money_summary() $$, '42501', null, 'anon cannot call admin_money_summary');
select tests.authenticate_as('ms_admin');
select throws_ok($$ select admin_money_summary() $$, '42501', null, 'an authenticated user JWT cannot call admin_money_summary');
select tests.authenticate_as_service_role();
select lives_ok($$ select admin_money_summary() $$, 'service_role can call admin_money_summary');

-- ---------------------------------------------------------------------------
-- (2) Windowed flows, January 2032.
-- ---------------------------------------------------------------------------

select is((select (j ->> 'gross_processed_kobo')::bigint from jan), (select (j ->> 'gross_processed_kobo')::bigint from win_base) + 11900, 'gross processed grew by 5900 + 3000 + 2000 + 1000 captured into escrow in the window');
select is((select (jan.j ->> 'gross_processed_card_kobo')::bigint - (w.j ->> 'gross_processed_card_kobo')::bigint from jan, win_base w), 9900::bigint, 'card part of processed is 5900 + 3000 + 1000');
select is((select (jan.j ->> 'gross_processed_wallet_kobo')::bigint - (w.j ->> 'gross_processed_wallet_kobo')::bigint from jan, win_base w), 2000::bigint, 'wallet part of processed is the 2000 wallet-funded order');
select is((select (jan.j ->> 'delivered_gmv_kobo')::bigint - (w.j ->> 'delivered_gmv_kobo')::bigint from jan, win_base w), 5900::bigint, 'delivered GMV in the window is order A (5900); March order E is outside');
select is((select (jan.j ->> 'delivered_orders')::bigint - (w.j ->> 'delivered_orders')::bigint from jan, win_base w), 1::bigint, 'one order was delivered in the window');
select is((select (jan.j ->> 'platform_earnings_kobo')::bigint - (w.j ->> 'platform_earnings_kobo')::bigint from jan, win_base w), 850::bigint, 'platform earnings = 850 (15% of 5000 + 100 service)');
select is((select (jan.j ->> 'vendor_earned_kobo')::bigint - (w.j ->> 'vendor_earned_kobo')::bigint from jan, win_base w), 4250::bigint, 'vendor earned 4250 (5000 less 15%)');
select is((select (jan.j ->> 'rider_earned_kobo')::bigint - (w.j ->> 'rider_earned_kobo')::bigint from jan, win_base w), 800::bigint, 'rider earned the 800 delivery fee');
select is((select (jan.j ->> 'refunded_kobo')::bigint - (w.j ->> 'refunded_kobo')::bigint from jan, win_base w), 4000::bigint, 'refunded = 3000 to the wallet + 1000 to the card (the short payment is not an order refund)');
select is((select (jan.j ->> 'refunded_gateway_kobo')::bigint - (w.j ->> 'refunded_gateway_kobo')::bigint from jan, win_base w), 1000::bigint, 'gateway refund 1000');
select is((select (jan.j ->> 'refunded_wallet_kobo')::bigint - (w.j ->> 'refunded_wallet_kobo')::bigint from jan, win_base w), 3000::bigint, 'wallet refund 3000');
select is((select (jan.j ->> 'paid_out_to_vendors_window_kobo')::bigint - (w.j ->> 'paid_out_to_vendors_window_kobo')::bigint from jan, win_base w), 1000::bigint, 'vendor payout in the window is 1000');
select is((select (jan.j ->> 'paid_out_to_riders_window_kobo')::bigint - (w.j ->> 'paid_out_to_riders_window_kobo')::bigint from jan, win_base w), 0::bigint, 'no rider payout in the window');

-- Half-open window: ends exclusive, starts inclusive (order A is released at 2032-01-06 00:00).
select is((admin_money_summary('2032-01-01', '2032-01-06') ->> 'delivered_orders')::bigint, 0::bigint, 'the window end is exclusive');
select is((admin_money_summary('2032-01-06', '2032-01-07') ->> 'delivered_orders')::bigint, 1::bigint, 'the window start is inclusive');
select is((admin_money_summary('2032-01-06', null) ->> 'delivered_orders')::bigint, 2::bigint, 'an open-ended window includes the later March delivery');

-- ---------------------------------------------------------------------------
-- (3) Point-in-time figures: deltas from the baseline, independent of the window.
-- ---------------------------------------------------------------------------

select is((select (a.j ->> 'held_in_escrow_kobo')::bigint - (b.j ->> 'held_in_escrow_kobo')::bigint from alltime a, base b), 2000::bigint, 'held in escrow grew by the 2000 wallet-funded order still in progress');
select is((select (a.j ->> 'owed_to_vendors_kobo')::bigint - (b.j ->> 'owed_to_vendors_kobo')::bigint from alltime a, base b), 3950::bigint, 'owed to vendors = 4250 + 700 - 1000 paid');
select is((select (a.j ->> 'owed_to_riders_kobo')::bigint - (b.j ->> 'owed_to_riders_kobo')::bigint from alltime a, base b), 1000::bigint, 'owed to riders = 800 + 200');
select is((select (a.j ->> 'paid_out_to_vendors_kobo')::bigint - (b.j ->> 'paid_out_to_vendors_kobo')::bigint from alltime a, base b), 1000::bigint, 'paid out to vendors all-time grew by 1000');
select is((select (a.j ->> 'paid_out_to_riders_kobo')::bigint - (b.j ->> 'paid_out_to_riders_kobo')::bigint from alltime a, base b), 0::bigint, 'paid out to riders did not change');
select is((select (a.j ->> 'customer_wallet_float_kobo')::bigint - (b.j ->> 'customer_wallet_float_kobo')::bigint from alltime a, base b), 1400::bigint, 'wallet float = 3000 refund - 2000 spent + 400 short payment');
select is((select (j ->> 'held_in_escrow_kobo')::bigint from jan), (select (j ->> 'held_in_escrow_kobo')::bigint from alltime), 'held is the same whatever the window');
select is((select (j ->> 'owed_to_vendors_kobo')::bigint from jan), (select (j ->> 'owed_to_vendors_kobo')::bigint from alltime), 'owed is the same whatever the window');

-- All-time: every capture and delivery, including March order E.
select is((select (a.j ->> 'gross_processed_kobo')::bigint - (b.j ->> 'gross_processed_kobo')::bigint from alltime a, base b), 12900::bigint, 'all-time processed grew by 12900 (the window figure plus order E)');
select is((select (a.j ->> 'delivered_orders')::bigint - (b.j ->> 'delivered_orders')::bigint from alltime a, base b), 2::bigint, 'all-time delivered grew by 2 (A and E)');
select is((select (a.j ->> 'platform_earnings_kobo')::bigint - (b.j ->> 'platform_earnings_kobo')::bigint from alltime a, base b), 950::bigint, 'all-time platform earnings grew by 850 + 100');

-- ---------------------------------------------------------------------------
-- (4) Reconciliation.
-- ---------------------------------------------------------------------------

select is(
  (select (a.j -> 'reconciliation' ->> 'difference_kobo')::bigint - (b.j -> 'reconciliation' ->> 'difference_kobo')::bigint from alltime a, base b),
  0::bigint, 'the seeded lifecycle leaves the reconciliation difference unchanged'
);
select is(
  (select (a.j -> 'reconciliation' ->> 'captured_kobo')::bigint - (b.j -> 'reconciliation' ->> 'captured_kobo')::bigint from alltime a, base b),
  12900::bigint, 'reconciliation captured grew by 12900'
);

-- Break it: 777 appears in escrow with no capture behind it.
insert into transactions (kind, reference, description) values ('adjustment', 'MS-BAD', 'fixture');
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, created_at)
select (select id from transactions where reference = 'MS-BAD'), a.id,
       case when a.kind = 'escrow' then 'credit' else 'debit' end, 777, 'adjustment', '2032-01-25'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind in ('escrow', 'gateway');

select is(
  (select (admin_money_summary() -> 'reconciliation' ->> 'difference_kobo')::bigint - (b.j -> 'reconciliation' ->> 'difference_kobo')::bigint from base b),
  -777::bigint, 'money in escrow without a capture shows as a -777 difference'
);
select is((select (admin_money_summary() -> 'reconciliation' ->> 'reconciles')::boolean), false, 'reconciles is false when the difference is non-zero');

-- ---------------------------------------------------------------------------
-- Input validation.
-- ---------------------------------------------------------------------------

select throws_ok($$ select admin_money_summary('2032-02-01', '2032-01-01') $$, '23514', null, 'an inverted window is a check_violation');
select throws_ok($$ select admin_money_summary('2032-01-01', '2032-01-01') $$, '23514', null, 'an empty window is a check_violation');

select * from finish();
rollback;
