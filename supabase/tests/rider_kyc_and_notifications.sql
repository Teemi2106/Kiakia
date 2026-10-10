-- pgTAP: rider_documents / rider_push_tokens / rider_notifications
-- (0052_rider_kyc_documents.sql, 0053_rider_push_notifications.sql,
-- 0056_rider_kyc_review_fixes.sql) plus get_rider_earnings_history()
-- (0054_rider_earnings_history.sql), sweep_dispatch_offers()
-- (0055_dispatch_offer_sweep.sql), and get_rider_offer_details()'s
-- expires_at fix (0057_rider_review_round_two.sql, task 2). None of these
-- had a test file before 0057. Same caveat as every other file in this
-- directory: not executed here (no Docker/Supabase CLI in this
-- environment), run via `supabase test db` or CI's `pgtap` job.
--
-- What this protects, in order of how bad getting it wrong would be:
-- (1) rider B must never read rider A's KYC documents, push tokens, or
-- notifications - three brand-new tables carrying real PII and push
-- capability, with the storage-path prefix check as the sole defence
-- against cross-rider document binding; (2) submit_rider_document()'s
-- prefix check must reject both an outright wrong prefix AND the specific
-- near-miss (a path that starts with the caller's own uid but with no '/'
-- immediately after it) that a looser "starts with" check would have let
-- through; (3) no authenticated session may write rider_documents directly,
-- only through the RPCs; (4) 0056's column-scoped UPDATE on
-- rider_notifications actually blocks title/body while still allowing
-- is_read; (5) get_rider_earnings_history() never leaks another rider's
-- payout history; (6) sweep_dispatch_offers() is genuinely unreachable by
-- a plain authenticated session; (7) 0057's expires_at fix on
-- get_rider_offer_details() actually takes effect for a stale, never-
-- accepted offer.
--
-- throws_ok() calls below use the 4-arg form (sql, sqlstate, exact
-- message, description) throughout - the 2-arg form treats the second
-- argument as an expected-message MATCH (pgTAP), not a free-text
-- description, unless it happens to be exactly 5 characters long (in which
-- case it is read as a SQLSTATE) - see transition_order.sql's own header
-- for the fuller version of this note.

begin;
select plan(19);

select tests.create_supabase_user('kyc_rider_a');
select tests.create_supabase_user('kyc_rider_b');
select tests.create_supabase_user('kyc_customer_a');
select tests.create_supabase_user('kyc_vendor_owner_a');
select tests.create_supabase_user('kyc_admin_a');

insert into user_roles (user_id, role) values (tests.get_supabase_uid('kyc_admin_a'), 'admin');

insert into vendors (id, owner_user_id, name, slug, status, is_accepting_orders, commission_bps)
values (
  '00000000-0000-7000-8000-0000000000a0',
  tests.get_supabase_uid('kyc_vendor_owner_a'),
  'KYC Test Vendor', 'kyc-test-vendor', 'active', true, 1500
);

insert into vendor_staff (vendor_id, user_id, role)
values ('00000000-0000-7000-8000-0000000000a0', tests.get_supabase_uid('kyc_vendor_owner_a'), 'vendor_owner');

insert into riders (user_id, is_online, current_location, kyc_status) values
  (tests.get_supabase_uid('kyc_rider_a'), true, st_geogfromtext('POINT(7.45 9.05)'), 'approved'),
  (tests.get_supabase_uid('kyc_rider_b'), true, st_geogfromtext('POINT(7.45 9.05)'), 'approved');

-- ---------------------------------------------------------------------------
-- submit_rider_document() - the prefix check.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('kyc_rider_a');

-- The near-miss this check specifically exists to catch: a path that
-- starts with the caller's own uid but has no '/' immediately after it
-- (e.g. a sibling folder named "<uid>extra"). A looser "starts with the
-- uid" check (without the trailing slash) would incorrectly accept this.
select throws_ok(
  format(
    $$ select submit_rider_document('government_id', %L) $$,
    tests.get_supabase_uid('kyc_rider_a')::text || 'extra/x.jpg'
  ),
  '42501',
  format(
    'submit_rider_document: storage_path %s does not belong to the caller',
    tests.get_supabase_uid('kyc_rider_a')::text || 'extra/x.jpg'
  ),
  'a near-miss path (own uid with no slash after it) is rejected, not just an outright wrong prefix'
);

-- The outright wrong prefix: rider A pointing a document row at rider B's
-- uploaded object path.
select throws_ok(
  format(
    $$ select submit_rider_document('government_id', %L) $$,
    tests.get_supabase_uid('kyc_rider_b')::text || '/gov.jpg'
  ),
  '42501',
  format(
    'submit_rider_document: storage_path %s does not belong to the caller',
    tests.get_supabase_uid('kyc_rider_b')::text || '/gov.jpg'
  ),
  'a path belonging to another rider is rejected'
);

-- The real thing: rider A's own uid, followed by a genuine '/', succeeds
-- and lands the document at status = 'pending'.
select is(
  (select status from submit_rider_document(
     'government_id',
     tests.get_supabase_uid('kyc_rider_a')::text || '/gov.jpg'
   )),
  'pending',
  'a path that genuinely belongs to the caller is accepted, landing at status = pending'
);

-- ---------------------------------------------------------------------------
-- Cross-rider read isolation - rider_documents, rider_push_tokens,
-- rider_notifications. Raw fixture rows for rider B's push token and
-- notification inserted unauthenticated (both tables revoke every write
-- from `authenticated` - 0052/0053/0056 - same convention every other test
-- file in this suite uses for tables with no authenticated write path).
-- ---------------------------------------------------------------------------

select tests.clear_authentication();

insert into rider_push_tokens (rider_id, token, platform, device_id)
values (tests.get_supabase_uid('kyc_rider_a'), 'expo-token-rider-a', 'android', 'device-a');

insert into rider_notifications (rider_id, title, body)
values (tests.get_supabase_uid('kyc_rider_a'), 'Test notification', 'Test body for rider A');

select tests.authenticate_as('kyc_rider_b');

select is(
  (select count(*)::int from rider_documents where rider_id = tests.get_supabase_uid('kyc_rider_a')),
  0,
  'rider B cannot see rider A''s rider_documents row'
);

select is(
  (select count(*)::int from rider_push_tokens where rider_id = tests.get_supabase_uid('kyc_rider_a')),
  0,
  'rider B cannot see rider A''s rider_push_tokens row'
);

select is(
  (select count(*)::int from rider_notifications where rider_id = tests.get_supabase_uid('kyc_rider_a')),
  0,
  'rider B cannot see rider A''s rider_notifications row'
);

select tests.authenticate_as('kyc_rider_a');

select is(
  (select count(*)::int from rider_documents where rider_id = tests.get_supabase_uid('kyc_rider_a')),
  1,
  'rider A can see their own rider_documents row (the RLS policy is not simply denying everyone)'
);

select is(
  (select count(*)::int from rider_push_tokens where rider_id = tests.get_supabase_uid('kyc_rider_a')),
  1,
  'rider A can see their own rider_push_tokens row'
);

select is(
  (select count(*)::int from rider_notifications where rider_id = tests.get_supabase_uid('kyc_rider_a')),
  1,
  'rider A can see their own rider_notifications row'
);

-- ---------------------------------------------------------------------------
-- No authenticated-reachable direct write path on rider_documents - every
-- write goes through submit_rider_document() / approve_rider_document() /
-- reject_rider_document() only.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into rider_documents (rider_id, doc_type, storage_path) values (auth.uid(), 'vehicle_photo', auth.uid()::text || '/veh.jpg') $$,
  '42501',
  'permission denied for table rider_documents',
  'a direct insert into rider_documents as authenticated is rejected, even for the caller''s own row'
);

select throws_ok(
  $$ update rider_documents set status = 'approved' where rider_id = auth.uid() $$,
  '42501',
  'permission denied for table rider_documents',
  'a direct update on rider_documents as authenticated is rejected, even for the caller''s own row'
);

-- ---------------------------------------------------------------------------
-- Resubmission semantics - reject_rider_document() sets a real review_note,
-- then submit_rider_document() must reset status to pending AND clear it.
-- Deliberately exercised via reject rather than approve: approve_rider_
-- document() always sets review_note = null itself (0053), so resubmitting
-- an approved row would never actually prove the clearing behaviour - the
-- rejected-with-a-real-note case is the one that does.
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();

select is(
  (select status from reject_rider_document(
     (select id from rider_documents where rider_id = tests.get_supabase_uid('kyc_rider_a') and doc_type = 'government_id'),
     tests.get_supabase_uid('kyc_admin_a'),
     'Blurry photo'
   )),
  'rejected',
  'reject_rider_document sets status = rejected with the admin-supplied note'
);

select tests.authenticate_as('kyc_rider_a');

select is(
  (select status from submit_rider_document(
     'government_id',
     tests.get_supabase_uid('kyc_rider_a')::text || '/gov-v2.jpg'
   )),
  'pending',
  'resubmitting a rejected document resets status back to pending'
);

select is(
  (select review_note from rider_documents where rider_id = tests.get_supabase_uid('kyc_rider_a') and doc_type = 'government_id'),
  null,
  'resubmitting clears the prior rejection''s review_note'
);

-- ---------------------------------------------------------------------------
-- rider_notifications - 0056's column-scoped UPDATE.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ update rider_notifications set title = 'rewritten' where rider_id = auth.uid() $$,
  '42501',
  'permission denied for table rider_notifications',
  'a rider cannot rewrite the title of their own rider_notifications row, only is_read is grantable'
);

select lives_ok(
  $$ update rider_notifications set is_read = true where rider_id = auth.uid() $$,
  'a rider CAN mark their own rider_notifications row read'
);

-- ---------------------------------------------------------------------------
-- get_rider_earnings_history() - never another rider's payout history.
-- ---------------------------------------------------------------------------

select tests.clear_authentication();

insert into orders (id, code, customer_id, vendor_id, rider_id, status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, rider_fee_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-0000000000a1',
  'KK-TESTA1',
  tests.get_supabase_uid('kyc_customer_a'),
  '00000000-0000-7000-8000-0000000000a0',
  tests.get_supabase_uid('kyc_rider_a'),
  'delivered', 500000, 50000, 10000, 0, 560000, 50000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.46 9.06)')
);

insert into accounts (owner_type, owner_id, kind) values ('platform', null, 'escrow')
  on conflict (owner_type, owner_id, kind) do nothing;
insert into accounts (owner_type, owner_id, kind) values ('rider', tests.get_supabase_uid('kyc_rider_a'), 'available')
  on conflict (owner_type, owner_id, kind) do nothing;

insert into transactions (kind, reference, order_id, description)
values ('escrow_release', 'KK-TESTA1-escrow', '00000000-0000-7000-8000-0000000000a1', 'test fixture');

insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select id, (select id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow'), 'debit', 50000, 'escrow_release', '00000000-0000-7000-8000-0000000000a1'
from transactions where reference = 'KK-TESTA1-escrow';

insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select id, (select id from accounts where owner_type = 'rider' and owner_id = tests.get_supabase_uid('kyc_rider_a')), 'credit', 50000, 'escrow_release', '00000000-0000-7000-8000-0000000000a1'
from transactions where reference = 'KK-TESTA1-escrow';

select tests.authenticate_as('kyc_rider_b');

select is(
  (select count(*)::int from get_rider_earnings_history()),
  0,
  'get_rider_earnings_history() returns zero rows for rider B when only rider A has a payout on record'
);

-- ---------------------------------------------------------------------------
-- sweep_dispatch_offers() - service_role only.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('kyc_rider_a');

select throws_ok(
  $$ select sweep_dispatch_offers() $$,
  'P0001',
  'sweep_dispatch_offers: requires the service-role key',
  'a plain authenticated session cannot call sweep_dispatch_offers()'
);

-- ---------------------------------------------------------------------------
-- get_rider_offer_details() - 0057's expires_at fix (task 2). An 'offered'
-- row that has passed its expiry no longer authorizes this read.
-- ---------------------------------------------------------------------------

select tests.clear_authentication();

insert into orders (id, code, customer_id, vendor_id, status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
values (
  '00000000-0000-7000-8000-0000000000a2',
  'KK-TESTA2',
  tests.get_supabase_uid('kyc_customer_a'),
  '00000000-0000-7000-8000-0000000000a0',
  'ready_for_pickup', 500000, 50000, 10000, 0, 560000,
  '{"line1": "1 Test Street"}'::jsonb,
  st_geogfromtext('POINT(7.46 9.06)')
);

-- expires_at explicitly in the past - simulating an offer nobody ever
-- accepted or declined, left behind because sweep_dispatch_offers() (0055)
-- is not scheduled anywhere (0057 task 3).
insert into dispatch_offers (order_id, rider_id, status, expires_at)
values (
  '00000000-0000-7000-8000-0000000000a2',
  tests.get_supabase_uid('kyc_rider_b'),
  'offered',
  now() - interval '5 minutes'
);

select tests.authenticate_as('kyc_rider_b');

select throws_ok(
  $$ select * from get_rider_offer_details('00000000-0000-7000-8000-0000000000a2'::uuid) $$,
  'P0001',
  format(
    'get_rider_offer_details: actor %s has no active offer or assignment on order 00000000-0000-7000-8000-0000000000a2',
    tests.get_supabase_uid('kyc_rider_b')
  ),
  'a rider whose only offer on this order has passed expires_at can no longer read its details (0057 task 2)'
);

select * from finish();
rollback;
