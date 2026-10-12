-- pgTAP: capture_payment() — the only writer of a payment's success state
-- and the ledger entries that come with it (0010_capture_payment.sql,
-- amount-mismatch detection added in
-- 0017_fix_capture_payment_amount_mismatch.sql). Same caveat as the other
-- files in this directory: not executed here (no Docker/Supabase CLI in
-- this environment), run via `supabase test db` or CI's `pgtap` job.
--
-- What this actually protects, in order of how bad getting it wrong would
-- be: (1) a customer must never be able to fabricate "my payment
-- succeeded" — service_role only; (2) every capture must produce a
-- balanced double-entry pair, never a lone debit or credit; (3) a
-- duplicate webhook delivery (Monnify *will* retry) must not double-credit
-- the platform escrow account; (4) a paid amount that doesn't match the
-- order's own total_kobo is still captured (funds already moved) but must
-- be handled explicitly, not silently absorbed (0075: underpaid is refused to
-- the wallet and the order stays unplaced; overpaid excess goes to the wallet).

begin;
select plan(16);

select tests.create_supabase_user('customer_a');
select tests.create_supabase_user('vendor_owner_a');

insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values ('00000000-0000-7000-8000-000000000020', tests.get_supabase_uid('vendor_owner_a'), 'Test Vendor', 'test-vendor-capture', 'active', 1500);

-- Starts 'draft' — capture_payment() ends by transitioning draft -> placed
-- (only a legal edge in order_status_transitions), so the fixture must
-- start there for a real (non-mocked) transition_order() call to succeed.
insert into orders (id, customer_id, vendor_id, status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000021',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000020',
  'draft', 500000, 50000, 10000, 0, 560000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);

insert into payments (id, order_id, provider, provider_ref, amount_kobo, status, idempotency_key)
values ('00000000-0000-7000-8000-000000000022', '00000000-0000-7000-8000-000000000021', 'monnify', 'mnfy-ref-cap-1', 560000, 'pending', 'KK-CAP-1');

-- A customer (or any `authenticated` caller) must never be able to
-- fabricate a successful payment — execute is revoked from authenticated,
-- granted to service_role only (0010_capture_payment.sql's file header).
select tests.authenticate_as('customer_a');
select throws_ok(
  $$ select capture_payment(
    p_order_id => '00000000-0000-7000-8000-000000000021'::uuid, p_provider_ref => 'mnfy-ref-cap-1', p_idempotency_key => 'KK-CAP-1',
    p_amount_kobo => 560000, p_raw => '{}'::jsonb, p_provider => 'monnify', p_channel => 'card'
  ) $$,
  '42501',
  null,
  'capture_payment is revoked from authenticated — only service_role may call it'
);
select tests.clear_authentication();

-- The Monnify webhook handler calls this via the service-role client.
select tests.authenticate_as_service_role();

select is(
  (select status from capture_payment(
    p_order_id => '00000000-0000-7000-8000-000000000021'::uuid, p_provider_ref => 'mnfy-ref-cap-1', p_idempotency_key => 'KK-CAP-1',
    p_amount_kobo => 560000, p_raw => '{}'::jsonb, p_provider => 'monnify', p_channel => 'card'
  )),
  'placed',
  'a successful capture transitions the order draft -> placed'
);

select is(
  (select status from payments where id = '00000000-0000-7000-8000-000000000022'),
  'success',
  'the payment row is marked success'
);

select is(
  (select count(*)::int from ledger_entries le join transactions t on t.id = le.transaction_id where t.reference = 'KK-CAP-1'),
  2,
  'exactly one debit + one credit ledger_entries row was created for the capture'
);

select is(
  (select coalesce(sum(amount_kobo) filter (where direction = 'debit'), 0) from ledger_entries le join transactions t on t.id = le.transaction_id where t.reference = 'KK-CAP-1'),
  (select coalesce(sum(amount_kobo) filter (where direction = 'credit'), 0) from ledger_entries le join transactions t on t.id = le.transaction_id where t.reference = 'KK-CAP-1'),
  'debits equal credits for the capture transaction (the ledger invariant, §9)'
);

-- A duplicate webhook delivery (Monnify retries on a slow 200) must be a
-- no-op, not a second capture — capture_payment() checks
-- payments.status = 'success' and short-circuits before touching the
-- ledger again.
select capture_payment(
    p_order_id => '00000000-0000-7000-8000-000000000021'::uuid, p_provider_ref => 'mnfy-ref-cap-1', p_idempotency_key => 'KK-CAP-1',
    p_amount_kobo => 560000, p_raw => '{}'::jsonb, p_provider => 'monnify', p_channel => 'card'
  );

select is(
  (select count(*)::int from ledger_entries le join transactions t on t.id = le.transaction_id where t.reference = 'KK-CAP-1'),
  2,
  'a duplicate call with the same idempotency_key does not create a second pair of ledger entries'
);

-- A shortpaid capture (paid amount does not match the order's own
-- total_kobo) is still captured — funds already moved via Monnify — but
-- must be flagged on the resulting order_events row, not silently
-- absorbed (0017_fix_capture_payment_amount_mismatch.sql).
insert into orders (id, customer_id, vendor_id, status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000023',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000020',
  'draft', 500000, 50000, 10000, 0, 560000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);
insert into payments (id, order_id, provider, provider_ref, amount_kobo, status, idempotency_key)
values ('00000000-0000-7000-8000-000000000024', '00000000-0000-7000-8000-000000000023', 'monnify', 'mnfy-ref-cap-2', 400000, 'pending', 'KK-CAP-2');

select capture_payment(
    p_order_id => '00000000-0000-7000-8000-000000000023'::uuid, p_provider_ref => 'mnfy-ref-cap-2', p_idempotency_key => 'KK-CAP-2',
    p_amount_kobo => 400000, p_raw => '{}'::jsonb, p_provider => 'monnify', p_channel => 'card'
  );

-- 0075_payment_path_fixes.sql changed this deliberately: a card payment that
-- does not match the order total is no longer booked-and-flagged
-- (amount_mismatch, order placed) because that jammed escrow release later.
-- Underpaid: the order is NOT placed, the money that arrived is credited to
-- the customer's wallet, the payments row stays pending for a full retry, and
-- an order_events row records underpaid_capture.
select is(
  (select (meta ->> 'underpaid_capture')::boolean from order_events where order_id = '00000000-0000-7000-8000-000000000023' order by at desc limit 1),
  true,
  'an underpaid capture is flagged underpaid_capture on its order_events row (0075; replaces 0017''s amount_mismatch flag)'
);

select is(
  (select status::text from orders where id = '00000000-0000-7000-8000-000000000023'),
  'draft',
  'an underpaid capture does NOT place the order (0075)'
);

select is(
  (select status from payments where id = '00000000-0000-7000-8000-000000000024'),
  'pending',
  'an underpaid capture leaves the payments row pending so the customer can retry in full (0075)'
);

select is(
  (select coalesce(sum(le.amount_kobo) filter (where le.direction = 'credit'), 0)::bigint
   from ledger_entries le join accounts a on a.id = le.account_id
   where a.owner_type = 'customer' and a.owner_id = tests.get_supabase_uid('customer_a') and a.kind = 'wallet'
     and le.order_id = '00000000-0000-7000-8000-000000000023'),
  400000::bigint,
  'an underpaid capture credits exactly the amount that arrived to the customer wallet (0075)'
);

-- Overpaid: escrow gets exactly total_kobo, the excess goes to the wallet in
-- the same balanced transaction, and the order is placed normally (0075).
insert into orders (id, customer_id, vendor_id, status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-000000000025',
  tests.get_supabase_uid('customer_a'),
  '00000000-0000-7000-8000-000000000020',
  'draft', 500000, 50000, 10000, 0, 560000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.45 9.05)')
);
insert into payments (id, order_id, provider, provider_ref, amount_kobo, status, idempotency_key)
values ('00000000-0000-7000-8000-000000000026', '00000000-0000-7000-8000-000000000025', 'monnify', 'mnfy-ref-cap-3', 600000, 'pending', 'KK-CAP-3');

select capture_payment(
  p_order_id => '00000000-0000-7000-8000-000000000025'::uuid, p_provider_ref => 'mnfy-ref-cap-3', p_idempotency_key => 'KK-CAP-3',
  p_amount_kobo => 600000, p_raw => '{}'::jsonb, p_provider => 'monnify', p_channel => 'card'
);

select is(
  (select coalesce(sum(le.amount_kobo) filter (where le.direction = 'credit' and a.kind = 'escrow'), 0)::bigint
   from ledger_entries le join accounts a on a.id = le.account_id where le.order_id = '00000000-0000-7000-8000-000000000025'),
  560000::bigint,
  'an overpaid capture credits escrow exactly total_kobo, not the paid amount (0075)'
);

select is(
  (select coalesce(sum(le.amount_kobo) filter (where le.direction = 'credit' and a.kind = 'wallet'), 0)::bigint
   from ledger_entries le join accounts a on a.id = le.account_id where le.order_id = '00000000-0000-7000-8000-000000000025'),
  40000::bigint,
  'an overpaid capture credits the excess to the customer wallet (0075)'
);

-- A second, genuinely different payment (distinct provider_ref) captured
-- against the same idempotency_key — routine now that retryPaymentAction
-- can leave multiple live Monnify checkout sessions per order — must not
-- silently vanish. No second ledger pair (still no double-credit), but a
-- duplicate_capture_attempt event is recorded (this migration's second fix).
select capture_payment(
    p_order_id => '00000000-0000-7000-8000-000000000021'::uuid, p_provider_ref => 'mnfy-ref-cap-1-retry', p_idempotency_key => 'KK-CAP-1',
    p_amount_kobo => 560000, p_raw => '{}'::jsonb, p_provider => 'monnify', p_channel => 'card'
  );

select is(
  (select count(*)::int from ledger_entries le join transactions t on t.id = le.transaction_id where t.reference = 'KK-CAP-1'),
  2,
  'a same-idempotency-key capture with a DIFFERENT provider_ref still does not create a second pair of ledger entries'
);

select is(
  (select (meta ->> 'duplicate_capture_attempt')::boolean from order_events where order_id = '00000000-0000-7000-8000-000000000021' and (meta ->> 'duplicate_capture_attempt') is not null order by at desc limit 1),
  true,
  'a same-idempotency-key/different-provider_ref capture is flagged as duplicate_capture_attempt on its own order_events row, not silently absorbed'
);

-- 0086_platform_accounts_unique.sql. UNVERIFIED, NOT RUN: added while local
-- Docker was off. The 0005 unique (owner_type, owner_id, kind) treats NULL
-- owner_id as distinct, so only the 0086 partial index stops a second
-- platform escrow account.
select tests.clear_authentication();
reset role;

select is(
  (select count(*)::int from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow'),
  1,
  'exactly one platform escrow account exists after all migrations'
);

select throws_ok(
  $$insert into accounts (owner_type, owner_id, kind) values ('platform', null, 'escrow')$$,
  '23505',
  null,
  'a second platform escrow account is rejected by the owner-less unique index (0086)'
);

select * from finish();
rollback;
