-- pgTAP: admin-configurable platform fees (0092_platform_fees.sql).
--
-- What this protects, in order of how bad getting it wrong would be:
-- (1) MONEY. Defaults equal the previously hard-coded numbers (2% service fee,
--     15% default commission) so behaviour is unchanged until an admin edits.
--     An order placed AFTER a fee change is priced with the new rate; an order
--     placed BEFORE keeps its stored service_fee_kobo/total_kobo. The escrow
--     release split (vendor + rider + platform) still equals the escrow, with
--     the new service fee flowing into the platform share.
-- (2) AUTHORITY. Only service_role may execute the writer, and the actor must
--     be a superadmin or finance admin; no client role can read or write
--     platform_settings directly; customers can read only the service-fee rate.
-- (3) VALIDATION + AUDIT. Out-of-range / unknown / blank-reason input is
--     rejected and writes nothing; a real change writes exactly one audit row
--     with before/after; an unchanged value is a no-op with no audit row.
--
-- Concurrency note: the writer takes `for update` on the one settings row, and
-- place_order() reads the rate with a plain committed read in its own
-- transaction, so a concurrent order sees either the old or the new rate in
-- full, never a mix. That needs two sessions and cannot run inside this
-- single-transaction script.

begin;
select plan(46);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('pf_admin');
select tests.create_supabase_user('pf_finance');
select tests.create_supabase_user('pf_super');
select tests.create_supabase_user('pf_customer');
select tests.create_supabase_user('pf_vendor_owner');
select tests.create_supabase_user('pf_vendor_owner2');
select tests.create_supabase_user('pf_rider');

insert into user_roles (user_id, role) values
  (tests.get_supabase_uid('pf_admin'), 'admin'),
  (tests.get_supabase_uid('pf_finance'), 'admin'),
  (tests.get_supabase_uid('pf_finance'), 'finance'),
  (tests.get_supabase_uid('pf_super'), 'superadmin');

insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo)
values (
  'bf000000-0000-7000-8000-000000000001', 'PF Area',
  st_geogfromtext('POLYGON((7.0 9.0, 8.0 9.0, 8.0 10.0, 7.0 10.0, 7.0 9.0))'),
  true, 50000, 15000
);

insert into vendors (id, owner_user_id, name, slug, status, is_accepting_orders, location, commission_bps, min_order_kobo)
values ('bf000000-0000-7000-8000-000000000002', tests.get_supabase_uid('pf_vendor_owner'), 'PF Vendor', 'pf-vendor', 'active', true,
        st_geogfromtext('POINT(7.5 9.5)'), 1500, 0);

insert into menu_items (id, vendor_id, name, price_kobo, is_available)
values ('bf000000-0000-7000-8000-000000000003', 'bf000000-0000-7000-8000-000000000002', 'PF Rice', 250000, true);

-- Two carts (2 x 250000 = 500000 each): one placed before the fee change, one
-- after. One open cart per customer, so the second is created after the first
-- is converted (section 7).
insert into carts (id, customer_id, vendor_id, status)
values ('bf000000-0000-7000-8000-000000000011', tests.get_supabase_uid('pf_customer'), 'bf000000-0000-7000-8000-000000000002', 'open');
insert into cart_items (cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, options_snapshot, line_total_kobo)
values ('bf000000-0000-7000-8000-000000000011', 'bf000000-0000-7000-8000-000000000003', 'PF Rice', 250000, 2, '[]'::jsonb, 500000);

-- ---------------------------------------------------------------------------
-- 1. Defaults preserve today's numbers
-- ---------------------------------------------------------------------------

select is((select value_int from platform_settings where key = 'service_fee_bps'), 200::bigint,
  'the service fee defaults to 200 bps (2%), the previously hard-coded rate');
select is((select value_int from platform_settings where key = 'default_vendor_commission_bps'), 1500::bigint,
  'the default vendor commission defaults to 1500 bps (15%), the previous column default');
select is((select count(*) from platform_settings where key in ('service_fee_bps', 'default_vendor_commission_bps')), 2::bigint, 'exactly the two known fees are seeded (dispatch keys, 0097, are separate)');

-- A vendor inserted without a commission gets the default (a column default that reads the setting).
insert into vendors (id, owner_user_id, name, slug, status)
values ('bf000000-0000-7000-8000-000000000004', tests.get_supabase_uid('pf_vendor_owner2'), 'PF New Vendor 1', 'pf-new-vendor-1', 'active');
select is((select commission_bps from vendors where id = 'bf000000-0000-7000-8000-000000000004'), 1500,
  'a new vendor starts at the default commission (15%) when nobody has changed it');

-- ---------------------------------------------------------------------------
-- 2. Privileges
-- ---------------------------------------------------------------------------

select ok(has_function_privilege('service_role', 'admin_set_platform_fee(text,bigint,text,uuid)', 'execute'),
  'service_role can execute admin_set_platform_fee');
select ok(not has_function_privilege('authenticated', 'admin_set_platform_fee(text,bigint,text,uuid)', 'execute'),
  'authenticated cannot execute admin_set_platform_fee');
select ok(not has_function_privilege('anon', 'admin_set_platform_fee(text,bigint,text,uuid)', 'execute'),
  'anon cannot execute admin_set_platform_fee');
select ok(not has_function_privilege('authenticated', '_platform_setting_int(text)', 'execute'),
  'authenticated cannot execute the internal settings reader');
select ok(not has_table_privilege('authenticated', 'platform_settings', 'select'),
  'authenticated has no table access to platform_settings');
select ok(not has_table_privilege('anon', 'platform_settings', 'select'),
  'anon has no table access to platform_settings');
select ok(has_table_privilege('service_role', 'platform_settings', 'select')
          and not has_table_privilege('service_role', 'platform_settings', 'update')
          and not has_table_privilege('service_role', 'platform_settings', 'insert'),
  'service_role can read platform_settings but only write through the RPC');
select ok(has_function_privilege('authenticated', 'get_service_fee_bps()', 'execute')
          and not has_function_privilege('anon', 'get_service_fee_bps()', 'execute'),
  'customers (authenticated) may read the live service-fee rate; anon may not');
select ok((select relrowsecurity from pg_class where oid = 'platform_settings'::regclass),
  'row level security is enabled on platform_settings');

-- ---------------------------------------------------------------------------
-- 3. Authority (as service_role, the only role that can call the writer)
-- ---------------------------------------------------------------------------

select tests.authenticate_as('pf_customer');
select throws_ok(
  $$ select admin_set_platform_fee('service_fee_bps', 300, 'customer tries', tests.get_supabase_uid('pf_customer')) $$,
  '42501', null, 'a signed-in customer is refused at the privilege level');
select throws_ok($$ select * from platform_settings $$, '42501', null,
  'a signed-in customer cannot read platform_settings directly');
select is(get_service_fee_bps(), 200, 'a signed-in customer can read the live service fee rate (200 bps)');

select tests.authenticate_as_service_role();
select throws_ok(
  $$ select admin_set_platform_fee('service_fee_bps', 300, 'plain admin', tests.get_supabase_uid('pf_admin')) $$,
  '42501', null, 'an admin without the finance role cannot change a fee');
select throws_ok(
  $$ select admin_set_platform_fee('service_fee_bps', 300, 'customer actor', tests.get_supabase_uid('pf_customer')) $$,
  'P0001', null, 'a non-admin actor id is refused');
select throws_ok(
  $$ select admin_set_platform_fee('service_fee_bps', 300, 'no actor', null) $$,
  'P0001', null, 'a missing actor is refused');

-- ---------------------------------------------------------------------------
-- 4. Validation bounds
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select admin_set_platform_fee('service_fee_bps', 2001, 'too high', tests.get_supabase_uid('pf_finance')) $$,
  '23514', null, 'a service fee above 20% (2000 bps) is rejected');
select throws_ok(
  $$ select admin_set_platform_fee('service_fee_bps', -1, 'negative', tests.get_supabase_uid('pf_finance')) $$,
  '23514', null, 'a negative service fee is rejected');
select throws_ok(
  $$ select admin_set_platform_fee('default_vendor_commission_bps', 5001, 'too high', tests.get_supabase_uid('pf_finance')) $$,
  '23514', null, 'a default commission above 50% (5000 bps) is rejected');
select throws_ok(
  $$ select admin_set_platform_fee('made_up_fee', 100, 'unknown', tests.get_supabase_uid('pf_finance')) $$,
  '23514', null, 'an unknown fee key is rejected');
select throws_ok(
  $$ select admin_set_platform_fee('service_fee_bps', null, 'null value', tests.get_supabase_uid('pf_finance')) $$,
  '23514', null, 'a null value is rejected');
select throws_ok(
  $$ select admin_set_platform_fee('service_fee_bps', 300, '   ', tests.get_supabase_uid('pf_finance')) $$,
  '23514', null, 'a blank reason is rejected');
select throws_ok(
  $$ update platform_settings set value_int = 99999 where key = 'service_fee_bps' $$,
  '42501', null, 'even service_role cannot write the table directly (RPC only)');
select is((select value_int from platform_settings where key = 'service_fee_bps'), 200::bigint,
  'rejected calls left the service fee unchanged');
select is((select count(*) from admin_audit_log where action = 'platform_fee.set'), 0::bigint,
  'rejected calls wrote no audit rows');

-- ---------------------------------------------------------------------------
-- 5. Order BEFORE the change keeps the old fee
-- ---------------------------------------------------------------------------

select tests.authenticate_as('pf_customer');
select is(
  (select service_fee_kobo from place_order('bf000000-0000-7000-8000-000000000011'::uuid, '{"line1": "1 Test"}'::jsonb,
     st_geogfromtext('POINT(7.5 9.5)'), null)),
  10000::bigint, 'an order placed at the default 2% pays a 10000 kobo service fee on 500000');

-- ---------------------------------------------------------------------------
-- 6. Change the fee (finance), audit, no-op
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
select is(
  (select value_int from admin_set_platform_fee('service_fee_bps', 500, 'Raise to 5% for launch', tests.get_supabase_uid('pf_finance'))),
  500::bigint, 'a finance admin can change the service fee');
select is((select updated_by from platform_settings where key = 'service_fee_bps'), tests.get_supabase_uid('pf_finance'),
  'updated_by records who changed it');
select is((select count(*) from admin_audit_log where action = 'platform_fee.set' and target_type = 'platform_setting'), 1::bigint,
  'exactly one audit row was written');
select is(
  (select details from admin_audit_log where action = 'platform_fee.set'),
  '{"key": "service_fee_bps", "unit": "bps", "from": 200, "to": 500}'::jsonb,
  'the audit row carries before and after');
select is((select reason from admin_audit_log where action = 'platform_fee.set'), 'Raise to 5% for launch',
  'the audit row carries the reason');
select is((select actor_id from admin_audit_log where action = 'platform_fee.set'), tests.get_supabase_uid('pf_finance'),
  'the audit row carries the actor');

select admin_set_platform_fee('service_fee_bps', 500, 'same value again', tests.get_supabase_uid('pf_finance'));
select is((select count(*) from admin_audit_log where action = 'platform_fee.set'), 1::bigint,
  'setting the same value again is a no-op with no second audit row');

select is(
  (select value_int from admin_set_platform_fee('service_fee_bps', 0, 'a superadmin may also set zero', tests.get_supabase_uid('pf_super'))),
  0::bigint, 'a superadmin can change a fee, and 0% is allowed');
select admin_set_platform_fee('service_fee_bps', 500, 'back to 5%', tests.get_supabase_uid('pf_super'));

-- ---------------------------------------------------------------------------
-- 7. Order AFTER the change uses the new fee; the earlier one is untouched
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
insert into carts (id, customer_id, vendor_id, status)
values ('bf000000-0000-7000-8000-000000000012', tests.get_supabase_uid('pf_customer'), 'bf000000-0000-7000-8000-000000000002', 'open');
insert into cart_items (cart_id, menu_item_id, name_snapshot, unit_price_kobo, qty, options_snapshot, line_total_kobo)
values ('bf000000-0000-7000-8000-000000000012', 'bf000000-0000-7000-8000-000000000003', 'PF Rice', 250000, 2, '[]'::jsonb, 500000);

select tests.authenticate_as('pf_customer');
select is(get_service_fee_bps(), 500, 'checkout now sees the new rate (500 bps)');
select is(
  (select service_fee_kobo from place_order('bf000000-0000-7000-8000-000000000012'::uuid, '{"line1": "1 Test"}'::jsonb,
     st_geogfromtext('POINT(7.5 9.5)'), null)),
  25000::bigint, 'an order placed after the change pays 5% (25000 kobo on 500000)');

select tests.authenticate_as_service_role();
select is(
  (select array_agg(service_fee_kobo order by service_fee_kobo) from orders where vendor_id = 'bf000000-0000-7000-8000-000000000002'),
  array[10000::bigint, 25000::bigint],
  'the earlier order still holds its original 10000 kobo service fee; the new one holds 25000');
select is(
  (select array_agg(total_kobo order by total_kobo) from orders where vendor_id = 'bf000000-0000-7000-8000-000000000002'),
  array[560000::bigint, 575000::bigint],
  'order totals are subtotal + delivery + the fee in force when each was placed');

-- ---------------------------------------------------------------------------
-- 8. Release split still reconciles with the new fee in the total
-- ---------------------------------------------------------------------------

insert into riders (user_id, is_online) values (tests.get_supabase_uid('pf_rider'), true);

-- Same amounts as the order placed at 5%: 500000 + 50000 + 25000 = 575000.
-- commission 15% = 75000, vendor 425000, rider 50000, platform = 100000.
insert into orders (id, customer_id, vendor_id, rider_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, rider_fee_kobo, delivery_address, delivery_location, arrived_at)
values ('bf000000-0000-7000-8000-000000000021', tests.get_supabase_uid('pf_customer'), 'bf000000-0000-7000-8000-000000000002',
        tests.get_supabase_uid('pf_rider'), 'arrived', 'paid', 500000, 50000, 25000, 0, 575000, 50000,
        '{"line1": "1 Test"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'), now() - interval '10 minutes');
insert into order_delivery_codes (order_id, code) values ('bf000000-0000-7000-8000-000000000021', '1234');

insert into transactions (id, kind, reference, order_id, description)
values ('bf000000-0000-7000-8000-000000000121', 'payment_capture', 'KK-PF-TEST-021', 'bf000000-0000-7000-8000-000000000021', 'fixture capture');
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select 'bf000000-0000-7000-8000-000000000121', a.id, 'debit', 575000, 'payment_capture', 'bf000000-0000-7000-8000-000000000021'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway';
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select 'bf000000-0000-7000-8000-000000000121', a.id, 'credit', 575000, 'payment_capture', 'bf000000-0000-7000-8000-000000000021'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'escrow';

select tests.authenticate_as('pf_rider');
select ok(
  (select r.code_matched from verify_delivery_and_release_escrow('bf000000-0000-7000-8000-000000000021'::uuid, '1234') r),
  'the order priced at the changed fee releases on delivery');

select tests.authenticate_as_service_role();
select is(
  (select coalesce(sum(le.amount_kobo), 0)::bigint from ledger_entries le join transactions t on t.id = le.transaction_id
   where t.order_id = 'bf000000-0000-7000-8000-000000000021' and t.kind = 'escrow_release' and le.direction = 'credit'),
  575000::bigint, 'vendor + rider + platform credits equal the escrow released (575000)');
select is(
  (select ab.balance_kobo::bigint from account_balances ab join accounts a on a.id = ab.account_id
   where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'revenue'),
  100000::bigint, 'the platform share is commission 75000 + the new 25000 service fee');

-- ---------------------------------------------------------------------------
-- 9. Default commission: only vendors created afterwards
-- ---------------------------------------------------------------------------

select admin_set_platform_fee('default_vendor_commission_bps', 1000, 'New vendors start at 10%', tests.get_supabase_uid('pf_finance'));
insert into vendors (id, owner_user_id, name, slug, status)
values ('bf000000-0000-7000-8000-000000000005', tests.get_supabase_uid('pf_customer'), 'PF New Vendor 2', 'pf-new-vendor-2', 'active');
select is((select commission_bps from vendors where id = 'bf000000-0000-7000-8000-000000000005'), 1000,
  'a vendor created after the change starts at the new default (10%)');
select is(
  (select array_agg(commission_bps order by id) from vendors where id in ('bf000000-0000-7000-8000-000000000002', 'bf000000-0000-7000-8000-000000000004')),
  array[1500, 1500],
  'vendors that already existed keep their commission');

select * from finish();
rollback;
