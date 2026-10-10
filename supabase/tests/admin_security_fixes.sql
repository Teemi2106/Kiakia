-- pgTAP: regression tests for the admin security review (0080_admin_audit_log.sql,
-- 0081_admin_operations.sql).
--
-- (1) EXECUTE grants: every admin RPC is callable by service_role only, the
--     internal helpers by nobody.
-- (2) B1: a refund replayed with a DIFFERENT destination is refused, so a
--     wallet-refunded order can never also be refunded to the card.
-- (3) S2: any role change to an admin/superadmin account needs a superadmin.
-- (4) S3/S4: suspending revokes auth sessions (and their refresh tokens);
--     admin_set_user_status reports whether it actually changed anything.
-- (5) S5: commission, service-area fees and payouts need a superadmin or an
--     admin holding 'finance'; fees are capped; the payout audit row never
--     holds a full account number.
--
-- Not covered here: the S6 last-superadmin guard. Reaching it needs the actor
-- to be suspended or demoted by a concurrent session, which a single pgTAP
-- transaction cannot stage.

begin;
select plan(95);

-- ---------------------------------------------------------------------------
-- (1) EXECUTE grants.
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege(r.role, f.sig, 'execute') = (r.role = 'service_role' and f.callable),
  format('%s: %s execute on %s', case when f.callable then 'RPC' else 'helper' end, r.role, f.sig)
)
from (values
  ('approve_vendor(uuid, uuid, text)', true),
  ('reject_vendor(uuid, uuid, text)', true),
  ('approve_rider(uuid, uuid, text)', true),
  ('reject_rider(uuid, uuid, text)', true),
  ('approve_rider_document(uuid, uuid)', true),
  ('reject_rider_document(uuid, uuid, text)', true),
  ('refund_order_escrow(uuid, uuid, text, text)', true),
  ('admin_reset_delivery_code_attempts(uuid, uuid, text)', true),
  ('order_refund_destination(text)', true),
  ('admin_set_user_status(uuid, text, text, uuid)', true),
  ('admin_set_platform_role(uuid, text, boolean, text, uuid)', true),
  ('admin_set_vendor_commission(uuid, integer, text, uuid)', true),
  ('admin_update_service_area(uuid, bigint, bigint, bigint, bigint, boolean, text, uuid)', true),
  ('admin_record_payout(text, uuid, bigint, text, text, uuid)', true),
  ('admin_request_gateway_refund(uuid, text, uuid)', true),
  ('admin_dashboard_metrics()', true),
  ('admin_ledger_health()', true),
  ('admin_list_balances(text, integer, integer, uuid)', true),
  ('_assert_admin_actor(text, uuid, text)', false),
  ('_write_admin_audit(uuid, text, text, uuid, text, jsonb)', false),
  ('_admin_reason(text, text, boolean)', false)
) as f(sig, callable)
cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role);

-- ---------------------------------------------------------------------------
-- Fixtures.
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('sf_admin');
select tests.create_supabase_user('sf_finance');
select tests.create_supabase_user('sf_finance_only');
select tests.create_supabase_user('sf_super');
select tests.create_supabase_user('sf_admin_target');
select tests.create_supabase_user('sf_target');
select tests.create_supabase_user('sf_customer');
select tests.create_supabase_user('sf_vendor_owner');
select tests.create_supabase_user('sf_rider');

insert into user_roles (user_id, role) values
  (tests.get_supabase_uid('sf_admin'), 'admin'),
  (tests.get_supabase_uid('sf_finance'), 'admin'),
  (tests.get_supabase_uid('sf_finance'), 'finance'),
  (tests.get_supabase_uid('sf_finance_only'), 'finance'),
  (tests.get_supabase_uid('sf_super'), 'superadmin'),
  (tests.get_supabase_uid('sf_admin_target'), 'admin');

insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values ('ad000000-0000-7000-8000-0000000001a1', tests.get_supabase_uid('sf_vendor_owner'), 'SF Vendor', 'sf-vendor', 'active', 1500);

insert into riders (user_id, is_online, kyc_status, bank_name, bank_account_name, bank_account_number)
values (tests.get_supabase_uid('sf_rider'), false, 'approved', 'GTBank', 'Rider SF', '0123456789');

insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
values ('ad000000-0000-7000-8000-0000000001b1', 'SF Area',
        st_geogfromtext('POLYGON((7.40 9.00, 7.50 9.00, 7.50 9.10, 7.40 9.10, 7.40 9.00))'),
        true, 50000, 10000, 30000, 5000);

-- Orders 1c1..1c3: captured (escrow funded), sitting at 'accepted'.
--   1c1 refunded to the wallet first, 1c2 to the gateway first, 1c3 never refunded.
insert into orders (id, customer_id, vendor_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
select ('ad000000-0000-7000-8000-0000000001' || n)::uuid, tests.get_supabase_uid('sf_customer'),
       'ad000000-0000-7000-8000-0000000001a1', 'accepted', 'paid',
       80000, 15000, 5000, 0, 100000, '{"line1": "1 SF Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)')
from (values ('c1'), ('c2'), ('c3')) v(n);

insert into transactions (kind, reference, order_id, description)
select 'payment_capture', 'SF-CAPTURE-' || o.code, o.id, 'fixture capture'
from orders o where o.id::text like 'ad000000-0000-7000-8000-0000000001c%';
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select t.id, a.id, case when a.kind = 'gateway' then 'debit' else 'credit' end, 100000, 'payment_capture', t.order_id
from transactions t
join accounts a on a.owner_type = 'platform' and a.owner_id is null and a.kind in ('gateway', 'escrow')
where t.reference like 'SF-CAPTURE-%';

-- Rider earnings of 30000 to pay out, funded from platform:gateway.
insert into accounts (owner_type, owner_id, kind) values ('rider', tests.get_supabase_uid('sf_rider'), 'available');
insert into transactions (id, kind, reference, description)
values ('ad000000-0000-7000-8000-0000000001d1', 'adjustment', 'SF-EARN-RIDER', 'fixture rider earnings');
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type)
select 'ad000000-0000-7000-8000-0000000001d1', a.id, case when a.kind = 'gateway' then 'debit' else 'credit' end, 30000, 'adjustment'
from accounts a
where (a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway')
   or (a.owner_type = 'rider' and a.owner_id = tests.get_supabase_uid('sf_rider') and a.kind = 'available');

set constraints ledger_entries_payee_available_not_negative immediate;

select tests.authenticate_as_service_role();

-- ---------------------------------------------------------------------------
-- (2) B1: refund destination replay guard.
-- ---------------------------------------------------------------------------

select refund_order_escrow('ad000000-0000-7000-8000-0000000001c1'::uuid, tests.get_supabase_uid('sf_admin'), 'wallet first');
select is((select payment_status from orders where id = 'ad000000-0000-7000-8000-0000000001c1'), 'refunded', 'a wallet refund marks the order refunded');
select is(order_refund_destination((select code from orders where id = 'ad000000-0000-7000-8000-0000000001c1')), 'wallet', 'the ledger says the wallet-refunded order went to the wallet');
select throws_ok(
  format($$ select refund_order_escrow('ad000000-0000-7000-8000-0000000001c1'::uuid, %L::uuid, 'now also the card', 'gateway') $$, tests.get_supabase_uid('sf_admin')),
  '23514', null, 'a gateway refund after a wallet refund is refused (the customer would be paid twice)'
);
select is(
  (select count(*)::int from ledger_entries where order_id = 'ad000000-0000-7000-8000-0000000001c1' and entry_type = 'refund'),
  2, 'the refused gateway refund moved no money (still the two wallet-refund entries)'
);
select is(
  (select count(*)::int from admin_audit_log where target_id = 'ad000000-0000-7000-8000-0000000001c1' and action = 'order.refund_escrow'),
  1, 'the refused gateway refund wrote no audit row'
);
select lives_ok(
  format($$ select refund_order_escrow('ad000000-0000-7000-8000-0000000001c1'::uuid, %L::uuid, 'wallet again') $$, tests.get_supabase_uid('sf_admin')),
  'replaying the SAME destination stays an idempotent no-op'
);

select refund_order_escrow('ad000000-0000-7000-8000-0000000001c2'::uuid, tests.get_supabase_uid('sf_admin'), 'card first', 'gateway');
select is(order_refund_destination((select code from orders where id = 'ad000000-0000-7000-8000-0000000001c2')), 'gateway', 'the ledger says the gateway-refunded order went to the gateway');
select throws_ok(
  format($$ select refund_order_escrow('ad000000-0000-7000-8000-0000000001c2'::uuid, %L::uuid, 'now also the wallet') $$, tests.get_supabase_uid('sf_admin')),
  '23514', null, 'a wallet refund after a gateway refund is refused'
);
select lives_ok(
  format($$ select refund_order_escrow('ad000000-0000-7000-8000-0000000001c2'::uuid, %L::uuid, 'card again', 'gateway') $$, tests.get_supabase_uid('sf_admin')),
  'replaying the same gateway destination stays an idempotent no-op'
);
select is(order_refund_destination((select code from orders where id = 'ad000000-0000-7000-8000-0000000001c3')), null, 'an order that was never refunded has no refund destination');

-- ---------------------------------------------------------------------------
-- (3) S2: touching an admin account's roles needs a superadmin.
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select admin_set_platform_role(%L::uuid, 'rider', true, 'r', %L::uuid) $$, tests.get_supabase_uid('sf_admin_target'), tests.get_supabase_uid('sf_admin')),
  '42501', format('admin_set_platform_role: actor %s is not a superadmin', tests.get_supabase_uid('sf_admin')),
  'a plain admin cannot grant even the rider role to an admin'
);
select is(
  admin_set_platform_role(tests.get_supabase_uid('sf_admin_target'), 'rider', true, 'admin who also rides', tests.get_supabase_uid('sf_super')),
  true, 'a superadmin can grant the rider role to an admin'
);
select throws_ok(
  format($$ select admin_set_platform_role(%L::uuid, 'rider', false, 'r', %L::uuid) $$, tests.get_supabase_uid('sf_admin_target'), tests.get_supabase_uid('sf_admin')),
  '42501', format('admin_set_platform_role: actor %s is not a superadmin', tests.get_supabase_uid('sf_admin')),
  'a plain admin cannot revoke the rider role from an admin'
);
select is(
  admin_set_platform_role(tests.get_supabase_uid('sf_target'), 'rider', true, 'support restore', tests.get_supabase_uid('sf_admin')),
  true, 'a plain admin can still change the rider role of an ordinary account'
);

-- ---------------------------------------------------------------------------
-- (4) S3 / S4: session revocation and the changed flag.
-- ---------------------------------------------------------------------------

reset role;
insert into auth.sessions (id, user_id) values ('ad000000-0000-7000-8000-0000000001e1', tests.get_supabase_uid('sf_target'));
insert into auth.refresh_tokens (session_id, user_id, token) values ('ad000000-0000-7000-8000-0000000001e1', tests.get_supabase_uid('sf_target')::text, 'sf-token-1');
select tests.authenticate_as_service_role();

select is(
  admin_set_user_status(tests.get_supabase_uid('sf_target'), 'suspended', 'abuse', tests.get_supabase_uid('sf_admin')),
  '{"status": "suspended", "previous_status": "active", "changed": true}'::jsonb,
  'suspending an active user reports a real transition'
);
reset role;
select is((select count(*)::int from auth.sessions where user_id = tests.get_supabase_uid('sf_target')), 0, 'suspending deletes the user''s auth sessions');
select is((select count(*)::int from auth.refresh_tokens where session_id = 'ad000000-0000-7000-8000-0000000001e1'), 0, 'and their refresh tokens go with them');
select tests.authenticate_as_service_role();

reset role;
insert into auth.sessions (id, user_id) values ('ad000000-0000-7000-8000-0000000001e2', tests.get_supabase_uid('sf_target'));
select tests.authenticate_as_service_role();
select is(
  admin_set_user_status(tests.get_supabase_uid('sf_target'), 'suspended', 'abuse again', tests.get_supabase_uid('sf_admin')),
  '{"status": "suspended", "previous_status": "suspended", "changed": false}'::jsonb,
  'replaying a suspension reports no change'
);
reset role;
select is((select count(*)::int from auth.sessions where user_id = tests.get_supabase_uid('sf_target')), 0, 'but still revokes any session that survived a half-applied suspension');
select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from admin_audit_log where action = 'user.suspend' and target_id = tests.get_supabase_uid('sf_target')),
  1, 'the replayed suspension wrote no second audit row'
);
select is(
  admin_set_user_status(tests.get_supabase_uid('sf_target'), 'active', null, tests.get_supabase_uid('sf_admin')),
  '{"status": "active", "previous_status": "suspended", "changed": true}'::jsonb,
  'reinstating a suspended user reports the suspended -> active transition'
);
select is(
  admin_set_user_status(tests.get_supabase_uid('sf_customer'), 'active', null, tests.get_supabase_uid('sf_admin')),
  '{"status": "active", "previous_status": "active", "changed": false}'::jsonb,
  'reinstating a user who was never suspended reports no change (so the app leaves their auth ban alone)'
);

-- ---------------------------------------------------------------------------
-- (5) S5: money-shaping changes need a superadmin or the finance role.
-- ---------------------------------------------------------------------------

select throws_ok(
  format($$ select admin_set_vendor_commission('ad000000-0000-7000-8000-0000000001a1'::uuid, 500, 'r', %L::uuid) $$, tests.get_supabase_uid('sf_admin')),
  '42501', format('admin_set_vendor_commission: actor %s is not a superadmin or finance', tests.get_supabase_uid('sf_admin')),
  'a plain admin cannot change a commission'
);
select throws_ok(
  format($$ select admin_update_service_area('ad000000-0000-7000-8000-0000000001b1'::uuid, 1, 1, 1, 1, true, 'r', %L::uuid) $$, tests.get_supabase_uid('sf_admin')),
  '42501', format('admin_update_service_area: actor %s is not a superadmin or finance', tests.get_supabase_uid('sf_admin')),
  'a plain admin cannot change service-area fees'
);
select throws_ok(
  format($$ select admin_record_payout('rider', %L::uuid, 1000, 'BANK-SF-0', 'r', %L::uuid) $$, tests.get_supabase_uid('sf_rider'), tests.get_supabase_uid('sf_admin')),
  '42501', format('admin_record_payout: actor %s is not a superadmin or finance', tests.get_supabase_uid('sf_admin')),
  'a plain admin cannot record a payout'
);
select throws_ok(
  format($$ select admin_set_vendor_commission('ad000000-0000-7000-8000-0000000001a1'::uuid, 500, 'r', %L::uuid) $$, tests.get_supabase_uid('sf_finance_only')),
  'P0001', format('admin_set_vendor_commission: actor %s is not an admin', tests.get_supabase_uid('sf_finance_only')),
  'the finance role alone is not enough: the actor must still be an admin'
);

select is(
  (admin_set_vendor_commission('ad000000-0000-7000-8000-0000000001a1'::uuid, 1800, 'negotiated', tests.get_supabase_uid('sf_finance'))).commission_bps,
  1800, 'an admin who holds the finance role can change a commission'
);
select is(
  (admin_update_service_area('ad000000-0000-7000-8000-0000000001b1'::uuid, 10000000, 0, 30000, 5000, true, 'cap', tests.get_supabase_uid('sf_super'))).base_delivery_fee_kobo,
  10000000::bigint, 'a superadmin can set a fee to exactly the NGN 100,000 cap'
);
select throws_ok(
  format($$ select admin_update_service_area('ad000000-0000-7000-8000-0000000001b1'::uuid, 10000001, 0, 30000, 5000, true, 'r', %L::uuid) $$, tests.get_supabase_uid('sf_super')),
  '23514', null, 'a fee above the cap is refused'
);

select is(
  (admin_record_payout('rider', tests.get_supabase_uid('sf_rider'), 12000, 'BANK-SF-1', 'weekly', tests.get_supabase_uid('sf_finance'))).kind,
  'payout', 'a finance admin can record a payout'
);
select is(
  (select details -> 'bank' ->> 'bank_account_number_masked' from admin_audit_log where action = 'payout.record' and target_id = tests.get_supabase_uid('sf_rider')),
  '******6789', 'the payout audit row keeps only the last 4 digits of the account number'
);
select ok(
  (select details::text not like '%0123456789%' and not (details -> 'bank') ? 'bank_account_number'
   from admin_audit_log where action = 'payout.record' and target_id = tests.get_supabase_uid('sf_rider')),
  'the full account number appears nowhere in the audit details'
);

select * from finish();
rollback;
