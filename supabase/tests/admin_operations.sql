-- pgTAP: behaviour of the admin RPCs (0080_admin_audit_log.sql,
-- 0081_admin_operations.sql): the audit row each mutation writes, business
-- guards, manual payouts and the ledger invariants around them. Companion
-- file: admin_authorization_and_audit_log.sql (who may call what, and the
-- append-only log itself).
--
-- What this protects, in order of how bad getting it wrong would be:
-- (1) MONEY. admin_record_payout can never overdraw a vendor/rider available
--     account (RPC balance check AND the deferred ledger trigger, tested
--     independently), is idempotent on the bank reference (a retry returns the
--     same transaction, never a second debit), refuses a reused reference with
--     different parameters, and writes a balanced DR owner:available /
--     CR platform:gateway transaction that get_rider_earnings() 'disbursed'
--     agrees with. refund_order_escrow replayed does not credit twice.
-- (2) AUDIT. Each successful mutation writes exactly one admin_audit_log row
--     (right actor / action / target / reason / details); a no-op or a refused
--     call writes none (asserted both per call and via the final total).
-- (3) BUSINESS GUARDS. No self-targeting, only a superadmin touches an admin,
--     suspending a rider takes them offline, rejecting a document needs a
--     note, reasons <= 1000 chars, commission 0-10000 bps, no negative fees.
-- (4) After everything above, admin_ledger_health() reports a clean ledger.
--
-- Constraint-trigger note: the payee-not-negative trigger is DEFERRED (fires
-- at COMMIT). This script never commits, so the money section runs with
-- `set constraints ... immediate` to make it fire at statement end; that is a
-- test-harness necessity, not a behaviour change.
--
-- The two-session concurrency check cannot run inside a single pgTAP
-- transaction; see the "CONCURRENCY" note at the bottom of this file.

begin;
select plan(171);

-- ---------------------------------------------------------------------------
-- Fixtures (written as the owner, before any role is assumed).
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('ops_admin');
select tests.create_supabase_user('ops_admin2');
select tests.create_supabase_user('ops_finance');
select tests.create_supabase_user('ops_super');
select tests.create_supabase_user('ops_customer');
select tests.create_supabase_user('ops_vendor_owner');
select tests.create_supabase_user('ops_rider');
select tests.create_supabase_user('ops_target');

insert into user_roles (user_id, role) values
  (tests.get_supabase_uid('ops_admin'), 'admin'),
  (tests.get_supabase_uid('ops_admin2'), 'admin'),
  (tests.get_supabase_uid('ops_finance'), 'admin'),
  (tests.get_supabase_uid('ops_finance'), 'finance'),
  (tests.get_supabase_uid('ops_super'), 'superadmin');

insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values ('ad000000-0000-7000-8000-000000000001', tests.get_supabase_uid('ops_vendor_owner'), 'Ops Vendor', 'ops-vendor', 'active', 1500);

insert into riders (user_id, is_online, kyc_status, bank_name, bank_account_name, bank_account_number)
values (tests.get_supabase_uid('ops_rider'), true, 'pending', 'GTBank', 'Rider Ops', '0123456789');

insert into rider_documents (id, rider_id, doc_type, storage_path)
values ('ad000000-0000-7000-8000-000000000011', tests.get_supabase_uid('ops_rider'), 'government_id', 'ops/id.png');

insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
values ('ad000000-0000-7000-8000-000000000021', 'Ops Area',
        st_geogfromtext('POLYGON((7.40 9.00, 7.50 9.00, 7.50 9.10, 7.40 9.10, 7.40 9.00))'),
        false, 50000, 10000, 30000, 5000);

-- Orders 31..34: captured (escrow funded) and sitting at 'accepted'.
--   31 wallet refund, 32 gateway refund with a card payment row,
--   33 card payment row but refunded to the WALLET, 34 gateway refund with NO payment row.
-- Order 35 is 'arrived' (delivery-code lockout reset), order 36 is not.
insert into orders (id, customer_id, vendor_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location, arrived_at)
select ('ad000000-0000-7000-8000-0000000000' || n)::uuid,
       tests.get_supabase_uid('ops_customer'),
       'ad000000-0000-7000-8000-000000000001',
       (case when n = '35' then 'arrived' else 'accepted' end)::order_status,
       case when n = '36' then 'pending' else 'paid' end,
       80000, 15000, 5000, 0, 100000,
       '{"line1": "1 Ops Street"}'::jsonb,
       st_geogfromtext('POINT(7.45 9.05)'),
       case when n = '35' then now() - interval '10 minutes' end
from (values ('31'), ('32'), ('33'), ('34'), ('35'), ('36')) v(n);

insert into transactions (id, kind, reference, order_id, description)
select ('ad000000-0000-7000-8000-0000000001' || right(o.id::text, 2))::uuid, 'payment_capture', 'AD-CAPTURE-' || o.code, o.id, 'fixture capture'
from orders o where o.id in (
  'ad000000-0000-7000-8000-000000000031', 'ad000000-0000-7000-8000-000000000032',
  'ad000000-0000-7000-8000-000000000033', 'ad000000-0000-7000-8000-000000000034',
  'ad000000-0000-7000-8000-000000000035');
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select t.id, a.id, case when a.kind = 'gateway' then 'debit' else 'credit' end, 100000, 'payment_capture', t.order_id
from transactions t
join accounts a on a.owner_type = 'platform' and a.owner_id is null and a.kind in ('gateway', 'escrow')
where t.reference like 'AD-CAPTURE-%';

insert into payments (order_id, provider_ref, amount_kobo, channel, status, idempotency_key)
select o.id, 'MNFY-' || o.code, 100000, 'card', 'success', o.code
from orders o where o.id in ('ad000000-0000-7000-8000-000000000032', 'ad000000-0000-7000-8000-000000000033');

-- Earnings to pay out: vendor 50000, rider 30000, as balanced ledger
-- transactions funded from platform:gateway (which is expected to run negative).
insert into accounts (owner_type, owner_id, kind) values
  ('vendor', 'ad000000-0000-7000-8000-000000000001', 'available'),
  ('rider', tests.get_supabase_uid('ops_rider'), 'available');
insert into transactions (id, kind, reference, description) values
  ('ad000000-0000-7000-8000-000000000141', 'adjustment', 'AD-EARN-VENDOR', 'fixture vendor earnings'),
  ('ad000000-0000-7000-8000-000000000142', 'adjustment', 'AD-EARN-RIDER', 'fixture rider earnings');
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type)
select 'ad000000-0000-7000-8000-000000000141', a.id, d.direction, 50000, 'adjustment'
from accounts a join (values ('gateway', 'debit'), ('available', 'credit')) d(kind, direction) on d.kind = a.kind
where (a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway')
   or (a.owner_type = 'vendor' and a.owner_id = 'ad000000-0000-7000-8000-000000000001' and a.kind = 'available');
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type)
select 'ad000000-0000-7000-8000-000000000142', a.id, d.direction, 30000, 'adjustment'
from accounts a join (values ('gateway', 'debit'), ('available', 'credit')) d(kind, direction) on d.kind = a.kind
where (a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway')
   or (a.owner_type = 'rider' and a.owner_id = tests.get_supabase_uid('ops_rider') and a.kind = 'available');

select is((select count(*)::int from admin_audit_log), 0, 'fixture: the audit log starts empty');

select tests.authenticate_as_service_role();

-- ---------------------------------------------------------------------------
-- Vendor / rider / document decisions: one audit row each, correct fields.
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select approve_vendor('ad000000-0000-7000-8000-000000000001'::uuid, %L::uuid, %L) $$, tests.get_supabase_uid('ops_admin'), repeat('x', 1001)),
  '23514', 'approve_vendor: reason must be at most 1000 characters',
  'a reason over 1000 characters is rejected'
);
select is((select count(*)::int from admin_audit_log), 0, 'a rejected reason wrote no audit row');

select reject_vendor('ad000000-0000-7000-8000-000000000001'::uuid, tests.get_supabase_uid('ops_admin'), '   ');
select is((select status from vendors where id = 'ad000000-0000-7000-8000-000000000001'), 'suspended', 'reject_vendor sets the vendor suspended');
select is(
  (select count(*)::int from admin_audit_log
   where action = 'vendor.reject' and target_type = 'vendor' and target_id = 'ad000000-0000-7000-8000-000000000001'
     and actor_id = tests.get_supabase_uid('ops_admin') and reason is null
     and details = '{"from_status": "active", "to_status": "suspended"}'::jsonb),
  1, 'reject_vendor wrote exactly one audit row (actor, action, target, before/after) and a blank reason is stored as NULL'
);

select approve_vendor('ad000000-0000-7000-8000-000000000001'::uuid, tests.get_supabase_uid('ops_admin'), repeat('y', 1000));
select is((select status from vendors where id = 'ad000000-0000-7000-8000-000000000001'), 'active', 'approve_vendor reinstates the vendor');
select is(
  (select char_length(reason) from admin_audit_log where action = 'vendor.approve' and target_id = 'ad000000-0000-7000-8000-000000000001'),
  1000, 'a reason of exactly 1000 characters is accepted and audited in full'
);
select is((select details ->> 'from_status' from admin_audit_log where action = 'vendor.approve'), 'suspended', 'approve_vendor audits the previous status');

select throws_ok(
  format($$ select approve_vendor('ad000000-0000-7000-8000-0000000000ee'::uuid, %L::uuid) $$, tests.get_supabase_uid('ops_admin')),
  'P0002', null, 'approving a missing vendor raises no_data_found'
);

select reject_rider(tests.get_supabase_uid('ops_rider'), tests.get_supabase_uid('ops_admin'), 'docs unreadable');
select is((select kyc_status from riders where user_id = tests.get_supabase_uid('ops_rider')), 'rejected', 'reject_rider sets kyc_status rejected');
select approve_rider(tests.get_supabase_uid('ops_rider'), tests.get_supabase_uid('ops_admin'));
select is((select kyc_status from riders where user_id = tests.get_supabase_uid('ops_rider')), 'approved', 'approve_rider sets kyc_status approved');
select is(
  (select count(*)::int from admin_audit_log
   where target_type = 'rider' and target_id = tests.get_supabase_uid('ops_rider') and actor_id = tests.get_supabase_uid('ops_admin')
     and ((action = 'rider.reject' and reason = 'docs unreadable' and details = '{"from_kyc_status": "pending", "to_kyc_status": "rejected"}'::jsonb)
       or (action = 'rider.approve' and reason is null and details = '{"from_kyc_status": "rejected", "to_kyc_status": "approved"}'::jsonb))),
  2, 'approve_rider and reject_rider each wrote one correct audit row'
);

select throws_ok(
  format($$ select reject_rider_document('ad000000-0000-7000-8000-000000000011'::uuid, %L::uuid, '   ') $$, tests.get_supabase_uid('ops_admin')),
  '23514', 'reject_rider_document: a reason is required', 'rejecting a rider document with a blank note is refused'
);
select throws_ok(
  format($$ select reject_rider_document('ad000000-0000-7000-8000-000000000011'::uuid, %L::uuid, null) $$, tests.get_supabase_uid('ops_admin')),
  '23514', 'reject_rider_document: a reason is required', 'rejecting a rider document with a NULL note is refused'
);
select is((select status from rider_documents where id = 'ad000000-0000-7000-8000-000000000011'), 'pending', 'a refused rejection left the document pending');

select reject_rider_document('ad000000-0000-7000-8000-000000000011'::uuid, tests.get_supabase_uid('ops_admin'), 'photo is blurry');
select is(
  (select status || '/' || review_note from rider_documents where id = 'ad000000-0000-7000-8000-000000000011'),
  'rejected/photo is blurry', 'reject_rider_document stores the (trimmed) note for the rider to see'
);
select approve_rider_document('ad000000-0000-7000-8000-000000000011'::uuid, tests.get_supabase_uid('ops_admin'));
select is(
  (select status || '/' || coalesce(review_note, 'NULL') from rider_documents where id = 'ad000000-0000-7000-8000-000000000011'),
  'approved/NULL', 'approve_rider_document clears the review note'
);
select is(
  (select count(*)::int from admin_audit_log
   where target_type = 'rider_document' and target_id = 'ad000000-0000-7000-8000-000000000011'
     and ((action = 'rider_document.reject' and reason = 'photo is blurry' and details ->> 'to_status' = 'rejected')
       or (action = 'rider_document.approve' and reason is null and details ->> 'to_status' = 'approved'
           and details ->> 'rider_id' = tests.get_supabase_uid('ops_rider')::text and details ->> 'doc_type' = 'government_id'))),
  2, 'document approve and reject each wrote one correct audit row'
);

select is((select count(*)::int from admin_audit_log), 6, 'running audit total: 2 vendor + 2 rider + 2 document rows, nothing from the 5 refused calls');

-- ---------------------------------------------------------------------------
-- admin_reset_delivery_code_attempts
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select admin_reset_delivery_code_attempts('ad000000-0000-7000-8000-000000000036'::uuid, %L::uuid) $$, tests.get_supabase_uid('ops_admin')),
  '23514', null, 'resetting an order that is not arrived is refused'
);
select admin_reset_delivery_code_attempts('ad000000-0000-7000-8000-000000000035'::uuid, tests.get_supabase_uid('ops_admin'), 'customer typo');
select is(
  (select count(*)::int from admin_audit_log
   where action = 'order.reset_delivery_code_attempts' and target_type = 'order' and target_id = 'ad000000-0000-7000-8000-000000000035'
     and actor_id = tests.get_supabase_uid('ops_admin') and reason = 'customer typo'),
  1, 'a successful reset wrote exactly one audit row'
);
select is(
  (select count(*)::int from order_events where order_id = 'ad000000-0000-7000-8000-000000000035' and actor_type = 'admin' and (meta ->> 'delivery_code_attempts_reset')::boolean is true),
  1, 'the reset marker event was written (this is what actually re-opens the attempt window)'
);
select is((select count(*)::int from admin_audit_log where target_id = 'ad000000-0000-7000-8000-000000000036'), 0, 'the refused reset wrote no audit row');

-- ---------------------------------------------------------------------------
-- refund_order_escrow: wallet + gateway, audit, replay no-op.
-- ---------------------------------------------------------------------------

select refund_order_escrow('ad000000-0000-7000-8000-000000000031'::uuid, tests.get_supabase_uid('ops_admin'), 'customer cancelled');
select is((select payment_status from orders where id = 'ad000000-0000-7000-8000-000000000031'), 'refunded', 'wallet refund marks the order refunded');
select is(
  (select le.amount_kobo from ledger_entries le join accounts a on a.id = le.account_id
   where le.order_id = 'ad000000-0000-7000-8000-000000000031' and le.entry_type = 'refund' and a.kind = 'wallet' and le.direction = 'credit'),
  100000::bigint, 'the wallet refund credits the customer wallet with exactly what was captured'
);
select is(
  (select count(*)::int from admin_audit_log
   where action = 'order.refund_escrow' and target_type = 'order' and target_id = 'ad000000-0000-7000-8000-000000000031'
     and actor_id = tests.get_supabase_uid('ops_admin') and reason = 'customer cancelled'
     and details ->> 'destination' = 'wallet' and (details ->> 'refunded_kobo')::bigint = 100000),
  1, 'refund_order_escrow wrote one audit row with destination and the ledger-derived amount'
);

select refund_order_escrow('ad000000-0000-7000-8000-000000000031'::uuid, tests.get_supabase_uid('ops_admin'), 'customer cancelled');
select is((select count(*)::int from admin_audit_log where target_id = 'ad000000-0000-7000-8000-000000000031'), 1, 'an idempotent refund replay writes no second audit row');
select is(
  (select count(*)::int from ledger_entries where order_id = 'ad000000-0000-7000-8000-000000000031' and entry_type = 'refund'),
  2, 'an idempotent refund replay does not double-credit the wallet (still 2 ledger entries)'
);

-- A replay that asks for a DIFFERENT destination than the ledger recorded is refused.
select throws_ok(
  format($$ select refund_order_escrow('ad000000-0000-7000-8000-000000000031'::uuid, %L::uuid, 'customer cancelled', 'gateway') $$, tests.get_supabase_uid('ops_admin')),
  '23514', null, 'replaying a wallet refund with destination gateway is refused (check_violation), not silently treated as the original'
);
select is(
  (select count(*)::int from ledger_entries where order_id = 'ad000000-0000-7000-8000-000000000031' and entry_type = 'refund'),
  2, 'the refused destination-mismatch replay wrote no ledger entries'
);

-- Orders 33 (wallet) and 34/32 (gateway).
select refund_order_escrow('ad000000-0000-7000-8000-000000000033'::uuid, tests.get_supabase_uid('ops_admin'), 'wallet refund, card payment exists');

-- ---------------------------------------------------------------------------
-- admin_request_gateway_refund eligibility.
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select admin_request_gateway_refund('ad000000-0000-7000-8000-0000000000ee'::uuid, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin')),
  'P0002', null, 'a gateway refund request for a missing order raises no_data_found'
);
select throws_ok(
  format($$ select admin_request_gateway_refund('ad000000-0000-7000-8000-000000000036'::uuid, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin')),
  '23514', null, 'an order with no card payment cannot be gateway-refunded'
);
select throws_ok(
  format($$ select admin_request_gateway_refund('ad000000-0000-7000-8000-000000000032'::uuid, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin')),
  '23514', null, 'a paid, not-yet-refunded card order is refused (the ledger has not refunded it to the gateway)'
);
select throws_ok(
  format($$ select admin_request_gateway_refund('ad000000-0000-7000-8000-000000000033'::uuid, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin')),
  '23514', null, 'a card order refunded to the WALLET is refused (the money is not at the gateway)'
);

select refund_order_escrow('ad000000-0000-7000-8000-000000000032'::uuid, tests.get_supabase_uid('ops_admin'), 'card refund', 'gateway');
select refund_order_escrow('ad000000-0000-7000-8000-000000000034'::uuid, tests.get_supabase_uid('ops_admin'), 'card refund, no payment row', 'gateway');
select is(
  (select count(*)::int from admin_audit_log where action = 'order.refund_escrow' and details ->> 'destination' = 'gateway'),
  2, 'both gateway refunds were audited with destination gateway'
);

select throws_ok(
  format($$ select admin_request_gateway_refund('ad000000-0000-7000-8000-000000000034'::uuid, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin')),
  '23514', null, 'a gateway-refunded order with no payments row is still refused'
);
select is((select count(*)::int from admin_audit_log where action = 'order.request_gateway_refund'), 0, 'none of the refused requests wrote an audit row');

select is(
  (admin_dashboard_metrics() -> 'gateway_refunds' ->> 'not_requested')::int,
  1, 'dashboard: one gateway refund is owed and not yet requested (order 32)'
);

select is(
  admin_request_gateway_refund('ad000000-0000-7000-8000-000000000032'::uuid, 'retry the Monnify call', tests.get_supabase_uid('ops_admin')),
  (select code from orders where id = 'ad000000-0000-7000-8000-000000000032'),
  'an eligible request returns the order code for the Monnify call'
);
select is(
  (select count(*)::int from admin_audit_log
   where action = 'order.request_gateway_refund' and target_type = 'order' and target_id = 'ad000000-0000-7000-8000-000000000032'
     and actor_id = tests.get_supabase_uid('ops_admin') and reason = 'retry the Monnify call'
     and details ->> 'provider_ref' = 'MNFY-' || (select code from orders where id = 'ad000000-0000-7000-8000-000000000032')),
  1, 'the eligible request wrote exactly one audit row'
);

reset role;
update payments set refund_reference = 'RF-1', refund_status = 'pending' where idempotency_key = (select code from orders where id = 'ad000000-0000-7000-8000-000000000032');
select tests.authenticate_as_service_role();

select throws_ok(
  format($$ select admin_request_gateway_refund('ad000000-0000-7000-8000-000000000032'::uuid, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin')),
  '23514', null, 'once payments.refund_reference is set a second request is refused'
);
select is((select count(*)::int from admin_audit_log where action = 'order.request_gateway_refund'), 1, 'the refused second request wrote no audit row');
select is(
  (admin_dashboard_metrics() -> 'gateway_refunds' ->> 'not_requested')::int || '/' || (admin_dashboard_metrics() -> 'gateway_refunds' ->> 'pending')::int,
  '0/1', 'dashboard: after the request is recorded the refund moves from not_requested to pending'
);

select is((select count(*)::int from admin_audit_log), 12, 'running audit total: 6 decisions + 1 reset + 4 refunds + 1 gateway request = 12, with no row from any refused or replayed call');

-- ---------------------------------------------------------------------------
-- admin_set_user_status
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select admin_set_user_status(%L::uuid, 'suspended', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin'), tests.get_supabase_uid('ops_admin')),
  '23514', 'admin_set_user_status: you cannot change your own account status', 'an admin cannot change their own status'
);
select throws_ok(
  format($$ select admin_set_user_status(%L::uuid, 'suspended', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_super'), tests.get_supabase_uid('ops_super')),
  '23514', 'admin_set_user_status: you cannot change your own account status', 'a superadmin cannot change their own status either'
);
select throws_ok(
  format($$ select admin_set_user_status(%L::uuid, 'banned', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_target'), tests.get_supabase_uid('ops_admin')),
  '23514', null, 'a status other than active/suspended is refused'
);
select throws_ok(
  format($$ select admin_set_user_status(%L::uuid, 'deleted', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_target'), tests.get_supabase_uid('ops_admin')),
  '23514', null, 'an admin cannot set a user to deleted'
);
select throws_ok(
  format($$ select admin_set_user_status(%L::uuid, 'suspended', '  ', %L::uuid) $$, tests.get_supabase_uid('ops_target'), tests.get_supabase_uid('ops_admin')),
  '23514', 'admin_set_user_status: a reason is required', 'suspending requires a reason'
);
select throws_ok(
  format($$ select admin_set_user_status(%L::uuid, 'suspended', %L, %L::uuid) $$, tests.get_supabase_uid('ops_target'), repeat('z', 1001), tests.get_supabase_uid('ops_admin')),
  '23514', 'admin_set_user_status: reason must be at most 1000 characters', 'a suspension reason over 1000 characters is refused'
);
select throws_ok(
  format($$ select admin_set_user_status('ad000000-0000-7000-8000-0000000000ee'::uuid, 'suspended', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin')),
  'P0002', null, 'a missing user raises no_data_found'
);
select throws_ok(
  format($$ select admin_set_user_status(%L::uuid, 'suspended', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin2'), tests.get_supabase_uid('ops_admin')),
  '42501', null, 'a plain admin cannot suspend another admin'
);
select is((select status from profiles where id = tests.get_supabase_uid('ops_admin2')), 'active', 'the refused admin suspension changed nothing');
select is((select count(*)::int from admin_audit_log), 12, 'none of the refused status changes wrote an audit row');

select is((select status from profiles where id = tests.get_supabase_uid('ops_target')), 'active', 'fixture: the target is active');
select is(
  admin_set_user_status(tests.get_supabase_uid('ops_target'), 'suspended', 'abuse reports', tests.get_supabase_uid('ops_admin')),
  '{"status": "suspended", "previous_status": "active", "changed": true}'::jsonb,
  'suspending reports {status, previous_status, changed: true}'
);
select is((select status from profiles where id = tests.get_supabase_uid('ops_target')), 'suspended', 'suspending a customer sets profiles.status');
select is(
  (select count(*)::int from admin_audit_log
   where action = 'user.suspend' and target_type = 'user' and target_id = tests.get_supabase_uid('ops_target')
     and actor_id = tests.get_supabase_uid('ops_admin') and reason = 'abuse reports'
     and details = '{"to_status": "suspended", "rider_taken_offline": false}'::jsonb),
  1, 'suspension wrote one audit row (rider_taken_offline false for a non-rider)'
);
select is(
  admin_set_user_status(tests.get_supabase_uid('ops_target'), 'suspended', 'abuse reports again', tests.get_supabase_uid('ops_admin')),
  '{"status": "suspended", "previous_status": "suspended", "changed": false}'::jsonb,
  'replaying a suspension reports changed: false'
);
select is((select count(*)::int from admin_audit_log where target_id = tests.get_supabase_uid('ops_target')), 1, 'suspending an already-suspended user is a no-op with no second audit row');
select is(
  admin_set_user_status(tests.get_supabase_uid('ops_target'), 'active', null, tests.get_supabase_uid('ops_admin')),
  '{"status": "active", "previous_status": "suspended", "changed": true}'::jsonb,
  'reinstating reports previous_status suspended and changed: true'
);
select is(
  (select count(*)::int from admin_audit_log
   where action = 'user.reinstate' and target_id = tests.get_supabase_uid('ops_target') and reason is null),
  1, 'reinstating needs no reason and writes one user.reinstate row'
);

select is((select is_online from riders where user_id = tests.get_supabase_uid('ops_rider')), true, 'fixture: the rider is online');
select admin_set_user_status(tests.get_supabase_uid('ops_rider'), 'suspended', 'fraud', tests.get_supabase_uid('ops_admin'));
select is((select is_online from riders where user_id = tests.get_supabase_uid('ops_rider')), false, 'suspending a rider forces them offline');
select is(
  (select details ->> 'rider_taken_offline' from admin_audit_log where action = 'user.suspend' and target_id = tests.get_supabase_uid('ops_rider')),
  'true', 'the audit row records that the rider was taken offline'
);
select admin_set_user_status(tests.get_supabase_uid('ops_rider'), 'active', null, tests.get_supabase_uid('ops_admin'));
select is((select is_online from riders where user_id = tests.get_supabase_uid('ops_rider')), false, 'reinstating a rider does not silently put them back online');

select admin_set_user_status(tests.get_supabase_uid('ops_admin2'), 'suspended', 'left the company', tests.get_supabase_uid('ops_super'));
select is((select status from profiles where id = tests.get_supabase_uid('ops_admin2')), 'suspended', 'a superadmin can suspend an admin');
select throws_ok(
  format($$ select approve_vendor('ad000000-0000-7000-8000-000000000001'::uuid, %L::uuid) $$, tests.get_supabase_uid('ops_admin2')),
  '42501', null, 'the admin suspended just now can no longer act (takes effect immediately)'
);

reset role;
update profiles set status = 'deleted' where id = tests.get_supabase_uid('ops_target');
select tests.authenticate_as_service_role();
select throws_ok(
  format($$ select admin_set_user_status(%L::uuid, 'active', null, %L::uuid) $$, tests.get_supabase_uid('ops_target'), tests.get_supabase_uid('ops_admin')),
  '23514', null, 'a deleted account cannot be reinstated'
);

-- ---------------------------------------------------------------------------
-- admin_set_platform_role
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select admin_set_platform_role(%L::uuid, 'rider', true, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin'), tests.get_supabase_uid('ops_admin')),
  '23514', 'admin_set_platform_role: you cannot change your own roles', 'an admin cannot change their own roles'
);
select throws_ok(
  format($$ select admin_set_platform_role(%L::uuid, 'admin', false, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_super'), tests.get_supabase_uid('ops_super')),
  '23514', 'admin_set_platform_role: you cannot change your own roles', 'a superadmin cannot revoke their own role (no self-demotion lockout)'
);
select throws_ok(
  format($$ select admin_set_platform_role(%L::uuid, 'vendor_owner', true, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_customer'), tests.get_supabase_uid('ops_super')),
  '23514', null, 'a role outside admin/superadmin/rider cannot be granted through this RPC'
);
select throws_ok(
  format($$ select admin_set_platform_role(%L::uuid, 'rider', null, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_customer'), tests.get_supabase_uid('ops_admin')),
  '23514', null, 'a NULL grant flag is refused'
);
select throws_ok(
  format($$ select admin_set_platform_role(%L::uuid, 'rider', true, '', %L::uuid) $$, tests.get_supabase_uid('ops_customer'), tests.get_supabase_uid('ops_admin')),
  '23514', 'admin_set_platform_role: a reason is required', 'a role change requires a reason'
);
select throws_ok(
  format($$ select admin_set_platform_role('ad000000-0000-7000-8000-0000000000ee'::uuid, 'rider', true, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin')),
  'P0002', null, 'a missing user raises no_data_found'
);
select is((select count(*)::int from admin_audit_log where action like 'user.%role'), 0, 'none of the refused role changes wrote an audit row');

select is(admin_set_platform_role(tests.get_supabase_uid('ops_customer'), 'admin', true, 'new ops hire', tests.get_supabase_uid('ops_super')), true, 'a superadmin can grant admin (returns true: a row changed)');
select is(
  (select count(*)::int from user_roles where user_id = tests.get_supabase_uid('ops_customer') and role = 'admin' and scope_type = 'platform'),
  1, 'the platform admin role row exists'
);
select is(
  (select count(*)::int from admin_audit_log
   where action = 'user.grant_role' and target_type = 'user' and target_id = tests.get_supabase_uid('ops_customer')
     and actor_id = tests.get_supabase_uid('ops_super') and reason = 'new ops hire' and details = '{"role": "admin"}'::jsonb),
  1, 'the grant wrote one audit row'
);
select is(admin_set_platform_role(tests.get_supabase_uid('ops_customer'), 'admin', true, 'again', tests.get_supabase_uid('ops_super')), false, 'granting a role already held is an idempotent no-op (returns false)');
select is((select count(*)::int from admin_audit_log where action = 'user.grant_role'), 1, 'the idempotent grant wrote no second audit row');
select is(admin_set_platform_role(tests.get_supabase_uid('ops_customer'), 'admin', false, 'left', tests.get_supabase_uid('ops_super')), true, 'a superadmin can revoke admin');
select is(
  (select count(*)::int from admin_audit_log where action = 'user.revoke_role' and target_id = tests.get_supabase_uid('ops_customer') and details = '{"role": "admin"}'::jsonb),
  1, 'the revoke wrote one audit row'
);
select is(admin_set_platform_role(tests.get_supabase_uid('ops_customer'), 'admin', false, 'again', tests.get_supabase_uid('ops_super')), false, 'revoking a role not held is an idempotent no-op');
select is((select count(*)::int from admin_audit_log where action = 'user.revoke_role'), 1, 'the idempotent revoke wrote no second audit row');

select is(admin_set_platform_role(tests.get_supabase_uid('ops_customer'), 'rider', true, 'support restore', tests.get_supabase_uid('ops_admin')), true, 'a plain admin can grant the rider role');
select is(
  (select count(*)::int from user_roles where user_id = tests.get_supabase_uid('ops_customer') and role = 'rider' and scope_type = 'platform' and scope_id is null),
  1, 'the rider role is platform-scoped with no scope_id, as register_rider() writes it'
);
select is(
  (select count(*)::int from admin_audit_log where action = 'user.grant_role' and target_id = tests.get_supabase_uid('ops_customer') and actor_id = tests.get_supabase_uid('ops_admin') and details = '{"role": "rider"}'::jsonb),
  1, 'the rider grant is audited under the plain admin actor'
);

select throws_ok(
  format($$ select admin_set_platform_role(%L::uuid, 'rider', true, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin2'), tests.get_supabase_uid('ops_admin')),
  '42501', null, 'a plain admin cannot change ANY role (even rider) on another admin: it needs a superadmin'
);

-- ---------------------------------------------------------------------------
-- admin_set_vendor_commission (needs superadmin or admin+finance; ops_finance
-- is the finance actor below, ops_admin is a plain admin and must be refused)
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select admin_set_vendor_commission('ad000000-0000-7000-8000-000000000001'::uuid, 1000, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin')),
  '42501', format('admin_set_vendor_commission: actor %s is not a superadmin or finance', tests.get_supabase_uid('ops_admin')),
  'a plain admin (no finance role) cannot change a vendor commission'
);
select is((select commission_bps from vendors where id = 'ad000000-0000-7000-8000-000000000001'), 1500, 'the refused plain-admin commission change left commission untouched');

select throws_ok(format($$ select admin_set_vendor_commission('ad000000-0000-7000-8000-000000000001'::uuid, -1, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', null, 'commission below 0 is refused');
select throws_ok(format($$ select admin_set_vendor_commission('ad000000-0000-7000-8000-000000000001'::uuid, 10001, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', null, 'commission above 10000 bps is refused');
select throws_ok(format($$ select admin_set_vendor_commission('ad000000-0000-7000-8000-000000000001'::uuid, null, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', null, 'a NULL commission is refused');
select throws_ok(format($$ select admin_set_vendor_commission('ad000000-0000-7000-8000-000000000001'::uuid, 1000, '', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', 'admin_set_vendor_commission: a reason is required', 'a commission change requires a reason');
select throws_ok(format($$ select admin_set_vendor_commission('ad000000-0000-7000-8000-0000000000ee'::uuid, 1000, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), 'P0002', null, 'a missing vendor raises no_data_found');
select is((select commission_bps from vendors where id = 'ad000000-0000-7000-8000-000000000001'), 1500, 'refused changes left commission untouched');

select is((admin_set_vendor_commission('ad000000-0000-7000-8000-000000000001'::uuid, 2000, 'negotiated', tests.get_supabase_uid('ops_finance'))).commission_bps, 2000, 'a valid commission change is applied');
select is(
  (select count(*)::int from admin_audit_log
   where action = 'vendor.set_commission' and target_type = 'vendor' and target_id = 'ad000000-0000-7000-8000-000000000001'
     and actor_id = tests.get_supabase_uid('ops_finance') and reason = 'negotiated' and details = '{"from_bps": 1500, "to_bps": 2000}'::jsonb),
  1, 'the change wrote one audit row with before/after'
);
select admin_set_vendor_commission('ad000000-0000-7000-8000-000000000001'::uuid, 2000, 'same again', tests.get_supabase_uid('ops_finance'));
select is((select count(*)::int from admin_audit_log where action = 'vendor.set_commission'), 1, 'an unchanged commission is a no-op with no audit row');
select is((admin_set_vendor_commission('ad000000-0000-7000-8000-000000000001'::uuid, 0, 'promo', tests.get_supabase_uid('ops_finance'))).commission_bps, 0, 'the lower bound 0 is accepted');
select is((admin_set_vendor_commission('ad000000-0000-7000-8000-000000000001'::uuid, 10000, 'cap', tests.get_supabase_uid('ops_finance'))).commission_bps, 10000, 'the upper bound 10000 is accepted');
select admin_set_vendor_commission('ad000000-0000-7000-8000-000000000001'::uuid, 1500, 'restore', tests.get_supabase_uid('ops_finance'));

-- ---------------------------------------------------------------------------
-- admin_update_service_area (finance tier; plain admin refused)
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select admin_update_service_area('ad000000-0000-7000-8000-000000000021'::uuid, 1, 1, 1, 1, true, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin')),
  '42501', format('admin_update_service_area: actor %s is not a superadmin or finance', tests.get_supabase_uid('ops_admin')),
  'a plain admin (no finance role) cannot update a service area'
);
select is((select base_delivery_fee_kobo from service_areas where id = 'ad000000-0000-7000-8000-000000000021'), 50000::bigint, 'the refused plain-admin service-area update left the fees untouched');

select throws_ok(format($$ select admin_update_service_area('ad000000-0000-7000-8000-000000000021'::uuid, -1, 10000, 30000, 5000, true, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', null, 'a negative base delivery fee is refused');
select throws_ok(format($$ select admin_update_service_area('ad000000-0000-7000-8000-000000000021'::uuid, 50000, -1, 30000, 5000, true, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', null, 'a negative per-km fee is refused');
select throws_ok(format($$ select admin_update_service_area('ad000000-0000-7000-8000-000000000021'::uuid, 50000, 10000, -1, 5000, true, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', null, 'a negative rider base fee is refused');
select throws_ok(format($$ select admin_update_service_area('ad000000-0000-7000-8000-000000000021'::uuid, 50000, 10000, 30000, -1, true, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', null, 'a negative rider per-km fee is refused');
select throws_ok(format($$ select admin_update_service_area('ad000000-0000-7000-8000-000000000021'::uuid, 50000, 10000, 30000, 5000, null, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', null, 'a NULL is_active is refused');
select throws_ok(format($$ select admin_update_service_area('ad000000-0000-7000-8000-000000000021'::uuid, 50000, 10000, 30000, 5000, true, ' ', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', 'admin_update_service_area: a reason is required', 'a service-area change requires a reason');
select throws_ok(format($$ select admin_update_service_area('ad000000-0000-7000-8000-0000000000ee'::uuid, 1, 1, 1, 1, true, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), 'P0002', null, 'a missing service area raises no_data_found');
select is((select base_delivery_fee_kobo from service_areas where id = 'ad000000-0000-7000-8000-000000000021'), 50000::bigint, 'refused updates left the fees untouched');

select admin_update_service_area('ad000000-0000-7000-8000-000000000021'::uuid, 60000, 12000, 35000, 6000, true, 'fuel price rise', tests.get_supabase_uid('ops_finance'));
select is(
  (select base_delivery_fee_kobo || '/' || per_km_fee_kobo || '/' || rider_base_fee_kobo || '/' || rider_per_km_fee_kobo || '/' || is_active from service_areas where id = 'ad000000-0000-7000-8000-000000000021'),
  '60000/12000/35000/6000/true', 'all four fees and is_active were updated'
);
select is(
  (select count(*)::int from admin_audit_log
   where action = 'service_area.update' and target_type = 'service_area' and target_id = 'ad000000-0000-7000-8000-000000000021'
     and actor_id = tests.get_supabase_uid('ops_finance') and reason = 'fuel price rise'
     and details -> 'before' ->> 'base_delivery_fee_kobo' = '50000' and details -> 'after' ->> 'base_delivery_fee_kobo' = '60000'
     and details -> 'before' ->> 'is_active' = 'false' and details -> 'after' ->> 'is_active' = 'true'
     and details ->> 'name' = 'Ops Area'),
  1, 'the update wrote one audit row with before/after snapshots'
);
select admin_update_service_area('ad000000-0000-7000-8000-000000000021'::uuid, 60000, 12000, 35000, 6000, true, 'no change', tests.get_supabase_uid('ops_finance'));
select is((select count(*)::int from admin_audit_log where action = 'service_area.update'), 1, 'an unchanged update is a no-op with no audit row');

-- ---------------------------------------------------------------------------
-- admin_record_payout: money.
-- ---------------------------------------------------------------------------

reset role;
set constraints ledger_entries_payee_available_not_negative immediate;
select tests.authenticate_as_service_role();

select is((select count(*)::int from admin_audit_log where action = 'payout.record'), 0, 'fixture: no payouts recorded yet');

select throws_ok(
  format($$ select admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, 100, 'BANK-REF-PA1', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_admin')),
  '42501', format('admin_record_payout: actor %s is not a superadmin or finance', tests.get_supabase_uid('ops_admin')),
  'a plain admin (no finance role) cannot record a payout'
);
select is((select count(*)::int from transactions where reference = 'payout-BANK-REF-PA1'), 0, 'the refused plain-admin payout created no transaction');

select throws_ok(format($$ select admin_record_payout('customer', %L::uuid, 100, 'BANK-REF-X1', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_customer'), tests.get_supabase_uid('ops_finance')), '23514', null, 'a payout owner type other than vendor/rider is refused');
select throws_ok(format($$ select admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, 0, 'BANK-REF-X2', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', 'admin_record_payout: amount must be a positive number of kobo', 'a zero payout is rejected');
select throws_ok(format($$ select admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, -500, 'BANK-REF-X3', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', 'admin_record_payout: amount must be a positive number of kobo', 'a negative payout is rejected');
select throws_ok(format($$ select admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, null, 'BANK-REF-X4', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', null, 'a NULL payout amount is rejected');
select throws_ok(format($$ select admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, 100, 'a b', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', null, 'a bank reference with a space is rejected');
select throws_ok(format($$ select admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, 100, 'ab', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', null, 'a bank reference shorter than 3 characters is rejected');
select throws_ok(format($$ select admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, 100, null, 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), '23514', null, 'a NULL bank reference is rejected');
select throws_ok(format($$ select admin_record_payout('vendor', 'ad000000-0000-7000-8000-0000000000ee'::uuid, 100, 'BANK-REF-X5', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), 'P0002', null, 'a payout to a missing vendor raises no_data_found');
select throws_ok(format($$ select admin_record_payout('rider', 'ad000000-0000-7000-8000-0000000000ee'::uuid, 100, 'BANK-REF-X6', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')), 'P0002', null, 'a payout to a missing rider raises no_data_found');

select throws_ok(
  format($$ select admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, 50001, 'BANK-REF-OD1', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')),
  '23514', null, 'a payout one kobo above the available balance is rejected (overdraw)'
);
select is((select count(*)::int from transactions where reference like 'payout-%'), 0, 'refused payouts created no transaction');
select is((select count(*)::int from admin_audit_log where action = 'payout.record'), 0, 'refused payouts wrote no audit row');

select admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, 20000, 'BANK-REF-001', 'weekly settlement', tests.get_supabase_uid('ops_finance'));

select is(
  (select kind || '/' || description from transactions where reference = 'payout-BANK-REF-001'),
  'payout/Manual bank payout, reference BANK-REF-001', 'the payout is a kind=payout transaction with reference payout-<bank ref>'
);
select is(
  (select count(*)::int from ledger_entries le join transactions t on t.id = le.transaction_id join accounts a on a.id = le.account_id
   where t.reference = 'payout-BANK-REF-001' and le.direction = 'debit' and le.amount_kobo = 20000 and le.entry_type = 'payout'
     and a.owner_type = 'vendor' and a.owner_id = 'ad000000-0000-7000-8000-000000000001' and a.kind = 'available'),
  1, 'DR the vendor available account'
);
select is(
  (select count(*)::int from ledger_entries le join transactions t on t.id = le.transaction_id join accounts a on a.id = le.account_id
   where t.reference = 'payout-BANK-REF-001' and le.direction = 'credit' and le.amount_kobo = 20000 and le.entry_type = 'payout'
     and a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway'),
  1, 'CR platform:gateway'
);
select is(
  (select sum(case when le.direction = 'debit' then le.amount_kobo else -le.amount_kobo end)::bigint from ledger_entries le join transactions t on t.id = le.transaction_id where t.reference = 'payout-BANK-REF-001'),
  0::bigint, 'the payout transaction is balanced'
);
select is(
  (select balance_kobo from admin_list_balances('vendor', 10, 0, 'ad000000-0000-7000-8000-000000000001'::uuid)),
  30000::bigint, 'the vendor available balance dropped by exactly the payout (50000 -> 30000)'
);
select is(
  (select count(*)::int from admin_audit_log
   where action = 'payout.record' and target_type = 'vendor' and target_id = 'ad000000-0000-7000-8000-000000000001'
     and actor_id = tests.get_supabase_uid('ops_finance') and reason = 'weekly settlement'
     and details ->> 'transaction_id' = (select id::text from transactions where reference = 'payout-BANK-REF-001')
     and details ->> 'reference' = 'payout-BANK-REF-001' and details ->> 'external_reference' = 'BANK-REF-001'
     and (details ->> 'amount_kobo')::bigint = 20000
     and (details ->> 'balance_before_kobo')::bigint = 50000 and (details ->> 'balance_after_kobo')::bigint = 30000),
  1, 'the payout wrote one audit row pointing at the ledger transaction with balance before/after'
);

-- Idempotent replay.
select is(
  (admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, 20000, 'BANK-REF-001', 'weekly settlement', tests.get_supabase_uid('ops_finance'))).id,
  (select id from transactions where reference = 'payout-BANK-REF-001'),
  'an idempotent replay (same reference, owner, amount) returns the SAME transaction'
);
select is((select count(*)::int from ledger_entries le join transactions t on t.id = le.transaction_id where t.reference = 'payout-BANK-REF-001'), 2, 'the replay created no extra ledger entries (no double debit)');
select is((select count(*)::int from admin_audit_log where action = 'payout.record'), 1, 'the replay wrote no second audit row');
select is(
  (admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, 20000, '  BANK-REF-001  ', 'weekly settlement', tests.get_supabase_uid('ops_finance'))).id,
  (select id from transactions where reference = 'payout-BANK-REF-001'),
  'the bank reference is trimmed, so a whitespace-padded replay is still the same payout'
);

-- Mismatched replays.
select throws_ok(
  format($$ select admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, 20001, 'BANK-REF-001', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')),
  '23505', 'admin_record_payout: reference BANK-REF-001 was already used for a different payout', 'the same reference with a different amount raises unique_violation'
);
select throws_ok(
  format($$ select admin_record_payout('rider', %L::uuid, 20000, 'BANK-REF-001', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_rider'), tests.get_supabase_uid('ops_finance')),
  '23505', 'admin_record_payout: reference BANK-REF-001 was already used for a different payout', 'the same reference with a different owner raises unique_violation rather than returning someone else''s payout'
);
select is((select count(*)::int from admin_audit_log where action = 'payout.record'), 1, 'mismatched replays wrote no audit row');

-- Overdraw again against the reduced balance, then the exact balance.
select throws_ok(
  format($$ select admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, 30001, 'BANK-REF-OD2', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')),
  '23514', null, 'a payout above the REMAINING balance (30001 > 30000) is rejected'
);
select is((select count(*)::int from transactions where reference = 'payout-BANK-REF-OD2'), 0, 'the overdraw attempt left no transaction behind');
select admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, 30000, 'BANK-REF-002', 'final settlement', tests.get_supabase_uid('ops_finance'));
select is(
  (select balance_kobo::text || '/' || disbursed_kobo::text from admin_list_balances('vendor', 10, 0, 'ad000000-0000-7000-8000-000000000001'::uuid)),
  '0/50000', 'a payout of exactly the available balance is allowed and leaves 0 (disbursed totals 50000)'
);
select throws_ok(
  format($$ select admin_record_payout('vendor', 'ad000000-0000-7000-8000-000000000001'::uuid, 1, 'BANK-REF-OD3', 'r', %L::uuid) $$, tests.get_supabase_uid('ops_finance')),
  '23514', null, 'with a zero balance even 1 kobo is rejected'
);

-- Rider payout + get_rider_earnings agreement.
select admin_record_payout('rider', tests.get_supabase_uid('ops_rider'), 10000, 'RIDER-REF-001', null, tests.get_supabase_uid('ops_finance'));
select is(
  (select count(*)::int from admin_audit_log
   where action = 'payout.record' and target_type = 'rider' and target_id = tests.get_supabase_uid('ops_rider')
     and reason is null and details -> 'bank' ->> 'bank_account_number_masked' = '******6789' and details -> 'bank' ->> 'bank_name' = 'GTBank'
     and (details ->> 'balance_before_kobo')::bigint = 30000 and (details ->> 'balance_after_kobo')::bigint = 20000),
  1, 'the rider payout audit row snapshots the rider''s bank name, MASKED account number (last 4) and balances'
);
select is(
  (select count(*)::int from admin_audit_log
   where action = 'payout.record' and (details::text like '%0123456789%' or (details -> 'bank') ? 'bank_account_number')),
  0, 'the full bank account number appears nowhere in any payout audit row'
);
select tests.authenticate_as('ops_rider');
select is(
  (select balance_kobo from get_rider_earnings() where account_kind = 'disbursed'),
  10000::bigint, 'get_rider_earnings() "disbursed" agrees with the recorded payout'
);
select is(
  (select balance_kobo from get_rider_earnings() where account_kind = 'available'),
  20000::bigint, 'get_rider_earnings() available reflects the payout'
);
select tests.authenticate_as_service_role();
select is(
  (select balance_kobo::text || '/' || disbursed_kobo::text || '/' || bank_name from admin_list_balances('rider', 10, 0, tests.get_supabase_uid('ops_rider'))),
  '20000/10000/GTBank', 'admin_list_balances agrees with get_rider_earnings and includes bank details for a rider'
);

-- The deferred trigger independently stops an overdraw written by anything else.
reset role;
select throws_ok(
  $$ with t as (
       insert into transactions (kind, reference, description) values ('adjustment', 'AD-OVERDRAW', 'raw overdraw') returning id
     )
     insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type)
     select t.id, a.id, d.direction, 20001, 'adjustment'
     from t, accounts a, (values ('available', 'debit'), ('gateway', 'credit')) d(kind, direction)
     where a.kind = d.kind
       and ((a.owner_type = 'rider' and a.owner_id = (select user_id from riders limit 1)) or (a.owner_type = 'platform' and a.owner_id is null)) $$,
  '23514', null, 'check_payee_available_not_negative rejects a raw ledger write that overdraws a rider available account, regardless of the writer'
);
select lives_ok(
  $$ with t as (
       insert into transactions (kind, reference, description) values ('adjustment', 'AD-NOT-OVERDRAW', 'raw debit to exactly zero') returning id
     )
     insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type)
     select t.id, a.id, d.direction, 20000, 'adjustment'
     from t, accounts a, (values ('available', 'debit'), ('gateway', 'credit')) d(kind, direction)
     where a.kind = d.kind
       and ((a.owner_type = 'rider' and a.owner_id = (select user_id from riders limit 1)) or (a.owner_type = 'platform' and a.owner_id is null)) $$,
  'the same raw write down to exactly zero is allowed (the trigger rejects only negative balances)'
);
set constraints ledger_entries_payee_available_not_negative deferred;
select tests.authenticate_as_service_role();

select is((select count(*)::int from admin_audit_log where action = 'payout.record'), 3, 'three payouts were audited in total (2 vendor, 1 rider)');

-- ---------------------------------------------------------------------------
-- Read RPCs.
-- ---------------------------------------------------------------------------

select throws_ok($$ select * from admin_list_balances('platform') $$, '23514', null, 'admin_list_balances refuses an unknown owner type');
select throws_ok($$ select * from admin_list_balances('vendor', 0) $$, '23514', null, 'admin_list_balances refuses limit 0');
select throws_ok($$ select * from admin_list_balances('vendor', 201) $$, '23514', null, 'admin_list_balances refuses limit above 200');
select throws_ok($$ select * from admin_list_balances('vendor', 10, -1) $$, '23514', null, 'admin_list_balances refuses a negative offset');
select is(
  (select balance_kobo from admin_list_balances('customer', 10, 0, tests.get_supabase_uid('ops_customer'))),
  200000::bigint, 'admin_list_balances(customer) shows the wallet credited by the two wallet refunds (orders 31 and 33)'
);
select is((select count(*)::int from admin_list_balances('vendor')), 1, 'admin_list_balances(vendor) lists the one vendor with an account');
select is((select total_count from admin_list_balances('vendor')), 1::bigint, 'total_count is the full count for pagination');

select is(
  (select array_agg(k order by k) from jsonb_object_keys(admin_dashboard_metrics()) k),
  array['capture_anomalies_7d', 'delivered', 'gateway_refunds', 'generated_at', 'orders_by_status', 'platform_revenue_30d_kobo', 'riders', 'stuck_orders', 'vendors_suspended'],
  'admin_dashboard_metrics returns the documented top-level keys'
);
select is(
  (admin_dashboard_metrics() -> 'orders_by_status' ->> 'arrived')::int,
  1, 'dashboard orders_by_status counts the one arrived order'
);
select is(
  (admin_dashboard_metrics() -> 'orders_by_status' ->> 'accepted')::int,
  1, 'dashboard orders_by_status counts accepted correctly (orders 31-34 were refunded to cancelled_by_platform; only the unpaid order 36 is still accepted)'
);

-- ---------------------------------------------------------------------------
-- Ledger health after everything above, and the final audit total.
-- ---------------------------------------------------------------------------

select is((admin_ledger_health() -> 'unbalanced_transactions' ->> 'count')::int, 0, 'admin_ledger_health: 0 unbalanced transactions after every refund and payout above');
select is((admin_ledger_health() -> 'escrow' ->> 'drift_kobo')::bigint, 0::bigint, 'admin_ledger_health: platform escrow actual = expected (no drift)');
select is(admin_ledger_health() -> 'negative_accounts', '[]'::jsonb, 'admin_ledger_health: no non-gateway account is negative');
select is(
  (admin_ledger_health() -> 'totals' ->> 'difference_kobo')::bigint, 0::bigint,
  'admin_ledger_health: global debits equal global credits'
);

reset role;
update ledger_entries set amount_kobo = amount_kobo + 1
where transaction_id = (select id from transactions where reference = 'AD-EARN-RIDER') and direction = 'credit';
select tests.authenticate_as_service_role();
select is(
  (admin_ledger_health() -> 'unbalanced_transactions' ->> 'count')::int, 1,
  'sanity: admin_ledger_health actually detects an unbalanced transaction (so the 0 above is meaningful)'
);

select is(
  (select count(*)::int from admin_audit_log),
  (select count(*)::int from admin_audit_log where actor_id in (tests.get_supabase_uid('ops_admin'), tests.get_supabase_uid('ops_finance'), tests.get_supabase_uid('ops_super'))),
  'every audit row names a real acting admin'
);

select * from finish();
rollback;

-- ---------------------------------------------------------------------------
-- CONCURRENCY (manual; cannot be expressed in one pgTAP transaction).
-- Two psql sessions, committed fixtures: a vendor with 50000 kobo available,
-- then in session A `begin; select admin_record_payout('vendor', <id>, 40000,
-- 'CONC-A', 'r', <admin>);` (do not commit), and in session B the same call
-- with 'CONC-B'. B blocks on the owner's available-account row lock until A
-- commits, then re-reads the balance (10000) and raises check_violation. The
-- procedure and its recorded result are in the Sprint 3 test report.
-- ---------------------------------------------------------------------------
