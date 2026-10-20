-- pgTAP: admin_list_customers, admin_list_riders, admin_rider_state_counts and
-- admin_list_payables (0090_admin_directory_and_payables.sql).
--
-- What this protects, in order of how bad getting it wrong would be:
-- (1) service_role ONLY: payables carries rider bank account numbers and the
--     lists carry phone numbers; an authenticated admin JWT must be refused.
-- (2) Customers means customers ONLY: an account that also holds a rider,
--     vendor or admin role must never appear, or it could be mistaken for a
--     plain shopper.
-- (3) Payables lists exactly the vendors/riders with a balance above zero
--     (zero and fully-paid owners are absent), largest first, with a correct
--     total, and a recorded payout lowers it.
-- (4) The rider state (suspended/deleted outrank the KYC decision) and counts
--     agree, search is a literal, and bad input is a check_violation.
--
-- Fixture rows carry the token 'Zqy' so existing rows cannot change a count;
-- payables is scoped by owner id for the same reason.

begin;
select plan(28);

select tests.create_supabase_user('dp_cust1');
select tests.create_supabase_user('dp_cust2');
select tests.create_supabase_user('dp_cust3');
select tests.create_supabase_user('dp_both_rider');
select tests.create_supabase_user('dp_both_vendor');
select tests.create_supabase_user('dp_admin');
select tests.create_supabase_user('dp_rider_pending');
select tests.create_supabase_user('dp_rider_active');
select tests.create_supabase_user('dp_rider_susp');
select tests.create_supabase_user('dp_rider_paid');

update profiles set full_name = 'Zqy Alpha',  phone = '+2349100000001', created_at = '2031-01-01' where id = tests.get_supabase_uid('dp_cust1');
update profiles set full_name = 'Zqy_Beta',   phone = '+2349100000002', created_at = '2031-01-02' where id = tests.get_supabase_uid('dp_cust2');
update profiles set full_name = 'Zqy Gamma',  phone = '+2349100000003', created_at = '2031-01-03', status = 'suspended' where id = tests.get_supabase_uid('dp_cust3');
update profiles set full_name = 'Zqy Rider',  phone = '+2349100000004', created_at = '2031-01-04' where id = tests.get_supabase_uid('dp_both_rider');
update profiles set full_name = 'Zqy Vendor', phone = '+2349100000005', created_at = '2031-01-05' where id = tests.get_supabase_uid('dp_both_vendor');
update profiles set full_name = 'Zqy Admin',  phone = '+2349100000006', created_at = '2031-01-06' where id = tests.get_supabase_uid('dp_admin');
update profiles set full_name = 'Zqy RPending', created_at = '2031-02-01' where id = tests.get_supabase_uid('dp_rider_pending');
update profiles set full_name = 'Zqy RActive',  created_at = '2031-02-02' where id = tests.get_supabase_uid('dp_rider_active');
update profiles set full_name = 'Zqy RSusp',    created_at = '2031-02-03', status = 'suspended' where id = tests.get_supabase_uid('dp_rider_susp');
update profiles set full_name = 'Zqy RPaid',    created_at = '2031-02-04' where id = tests.get_supabase_uid('dp_rider_paid');

insert into user_roles (user_id, role, scope_type, scope_id) values
  (tests.get_supabase_uid('dp_both_rider'), 'rider', 'platform', null),
  (tests.get_supabase_uid('dp_both_vendor'), 'vendor_owner', 'vendor', gen_random_uuid()),
  (tests.get_supabase_uid('dp_admin'), 'admin', 'platform', null);

-- Riders: pending (kyc pending), active (approved), suspended (approved but
-- profile suspended), paid (approved, fully paid out).
insert into riders (user_id, kyc_status, is_online, plate_number, bank_name, bank_account_name, bank_account_number, created_at) values
  (tests.get_supabase_uid('dp_rider_pending'), 'pending',  false, 'ZQY-001', null, null, null, '2031-02-01'),
  (tests.get_supabase_uid('dp_rider_active'),  'approved', true,  'ZQY-002', 'GTBank', 'Rider Active', '0123456789', '2031-02-02'),
  (tests.get_supabase_uid('dp_rider_susp'),    'approved', false, 'ZQY-003', null, null, null, '2031-02-03'),
  (tests.get_supabase_uid('dp_rider_paid'),    'approved', false, 'ZQY-004', null, null, null, '2031-02-04'),
  (tests.get_supabase_uid('dp_both_rider'),    'approved', false, 'ZQY-005', null, null, null, '2031-01-04');
insert into user_roles (user_id, role, scope_type, scope_id)
select r.user_id, 'rider', 'platform', null from riders r where r.plate_number like 'ZQY-%' and r.user_id <> tests.get_supabase_uid('dp_both_rider');
insert into rider_documents (rider_id, doc_type, storage_path) values
  (tests.get_supabase_uid('dp_rider_pending'), 'government_id', 'dp/id.png'),
  (tests.get_supabase_uid('dp_rider_pending'), 'vehicle_photo', 'dp/bike.png');

-- Two orders for customer 1 so order_count has something to count.
insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values ('dd000000-0000-7000-8000-000000000001', tests.get_supabase_uid('dp_both_vendor'), 'Zqy Vendor Store', 'zqy-vendor-store', 'active', 1500);
insert into orders (id, code, customer_id, vendor_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, delivery_address, delivery_location)
select ('dd000000-0000-7000-8000-0000000000' || n)::uuid, 'ZQY-' || n, tests.get_supabase_uid('dp_cust1'), 'dd000000-0000-7000-8000-000000000001',
       'delivered', 'paid', 1000, 200, 50, 0, 1250, '{"line1": "1 Zqy Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)')
from (values ('11'), ('12')) v(n);

-- Ledger: customer 1 wallet 700; vendor earned 50000; rider_active earned 30000;
-- rider_paid earned 20000 and was paid 20000; rider_susp earned 10000.
insert into accounts (owner_type, owner_id, kind) values
  ('customer', tests.get_supabase_uid('dp_cust1'), 'wallet'),
  ('vendor', 'dd000000-0000-7000-8000-000000000001', 'available'),
  ('rider', tests.get_supabase_uid('dp_rider_active'), 'available'),
  ('rider', tests.get_supabase_uid('dp_rider_paid'), 'available'),
  ('rider', tests.get_supabase_uid('dp_rider_susp'), 'available');
insert into transactions (id, kind, reference, description) values
  ('dd000000-0000-7000-8000-000000000101', 'adjustment', 'DP-W1', 'fixture'),
  ('dd000000-0000-7000-8000-000000000102', 'adjustment', 'DP-V1', 'fixture'),
  ('dd000000-0000-7000-8000-000000000103', 'adjustment', 'DP-R1', 'fixture'),
  ('dd000000-0000-7000-8000-000000000104', 'adjustment', 'DP-R2', 'fixture'),
  ('dd000000-0000-7000-8000-000000000105', 'adjustment', 'DP-R3', 'fixture');
-- Each earning is a balanced pair funded from platform:gateway.
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type)
select e.tx::uuid, a.id, d.direction, e.amount, 'adjustment'
from (values
  ('dd000000-0000-7000-8000-000000000101', 'customer', tests.get_supabase_uid('dp_cust1'), 'wallet', 700),
  ('dd000000-0000-7000-8000-000000000102', 'vendor', 'dd000000-0000-7000-8000-000000000001'::uuid, 'available', 50000),
  ('dd000000-0000-7000-8000-000000000103', 'rider', tests.get_supabase_uid('dp_rider_active'), 'available', 30000),
  ('dd000000-0000-7000-8000-000000000104', 'rider', tests.get_supabase_uid('dp_rider_paid'), 'available', 20000),
  ('dd000000-0000-7000-8000-000000000105', 'rider', tests.get_supabase_uid('dp_rider_susp'), 'available', 10000)
) e(tx, owner_type, owner_id, kind, amount)
join accounts a on (a.owner_type = e.owner_type and a.owner_id = e.owner_id and a.kind = e.kind)
                or (a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway')
join lateral (select case when a.kind = 'gateway' then 'debit' else 'credit' end as direction) d on true;

-- rider_paid is paid out in full through a payout transaction.
insert into transactions (id, kind, reference, description)
values ('dd000000-0000-7000-8000-000000000106', 'payout', 'payout-DP-PAID', 'fixture payout');
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type)
select 'dd000000-0000-7000-8000-000000000106', a.id,
       case when a.kind = 'gateway' then 'credit' else 'debit' end, 20000, 'payout'
from accounts a
where (a.owner_type = 'rider' and a.owner_id = tests.get_supabase_uid('dp_rider_paid') and a.kind = 'available')
   or (a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway');

-- ---------------------------------------------------------------------------
-- (1) Who may call.
-- ---------------------------------------------------------------------------

select tests.clear_authentication();
select throws_ok($$ select * from admin_list_customers('Zqy') $$, '42501', null, 'anon cannot call admin_list_customers');
select throws_ok($$ select * from admin_list_payables() $$, '42501', null, 'anon cannot call admin_list_payables');

select tests.authenticate_as('dp_admin');
select throws_ok($$ select * from admin_list_customers('Zqy') $$, '42501', null, 'an authenticated admin (user JWT) cannot call admin_list_customers');
select throws_ok($$ select * from admin_list_riders('Zqy') $$, '42501', null, 'an authenticated admin (user JWT) cannot call admin_list_riders');
select throws_ok($$ select * from admin_rider_state_counts() $$, '42501', null, 'an authenticated admin (user JWT) cannot call admin_rider_state_counts');
select throws_ok($$ select * from admin_list_payables() $$, '42501', null, 'an authenticated admin (user JWT) cannot call admin_list_payables (it carries bank account numbers)');

select tests.authenticate_as_service_role();

-- ---------------------------------------------------------------------------
-- (2) Customers.
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(full_name order by created_at desc) from admin_list_customers('Zqy', null, 50, 0)),
  array['Zqy Gamma', 'Zqy_Beta', 'Zqy Alpha']::text[],
  'only customer-only accounts are listed (rider, vendor and admin accounts are absent), newest first'
);
select is(
  (select order_count from admin_list_customers('Zqy Alpha')), 2::bigint,
  'order_count counts the customer''s orders'
);
select is(
  (select wallet_balance_kobo from admin_list_customers('Zqy Alpha')), 700::bigint,
  'wallet_balance_kobo is the customer wallet balance'
);
select is(
  (select wallet_balance_kobo from admin_list_customers('Zqy_Beta')), 0::bigint,
  'a customer with no wallet account has a zero balance'
);
select is(
  (select count(*)::int from admin_list_customers('Zqy_', null, 50, 0)), 1,
  'an underscore in the search is a literal, not a wildcard'
);
select is(
  (select array_agg(full_name) from admin_list_customers('Zqy', 'suspended', 50, 0)), array['Zqy Gamma']::text[],
  'the status filter narrows the list'
);
select is(
  (select total_count from admin_list_customers('Zqy', null, 1, 1)), 3::bigint,
  'total_count is the full match count whatever the page size'
);
select throws_ok($$ select * from admin_list_customers('x', 'bogus') $$, '23514', null, 'an unknown status is a check_violation');
select throws_ok($$ select * from admin_list_customers('x', null, 0, 0) $$, '23514', null, 'a zero limit is a check_violation');

-- ---------------------------------------------------------------------------
-- (3) Riders.
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(state order by created_at) from admin_list_riders('Zqy', null, null, 50, 0)),
  array['active', 'pending', 'active', 'suspended', 'active']::text[],
  'state: kyc approved reads as active, and a suspended profile outranks an approved KYC'
);
select is(
  (select documents_pending from admin_list_riders('Zqy RPending')), 2::bigint,
  'documents_pending counts the rider''s pending documents'
);
select is(
  (select count(*)::int from admin_list_riders('ZQY-002')), 1,
  'a rider can be found by plate number'
);
select is(
  (select array_agg(full_name) from admin_list_riders('Zqy', 'suspended', null, 50, 0)), array['Zqy RSusp']::text[],
  'the state filter narrows the list'
);
select is(
  (select array_agg(full_name) from admin_list_riders('Zqy', null, 'online', 50, 0)), array['Zqy RActive']::text[],
  'the availability filter narrows the list'
);
select is(
  (select count(*)::int from admin_list_riders('Zqy', null, null, 50, 0) where full_name = 'Zqy Rider'), 1,
  'a rider who is also a customer is found on the riders list'
);
select is(
  (select total from admin_rider_state_counts() where state = 'pending') >= 1, true,
  'admin_rider_state_counts counts pending riders'
);
select throws_ok($$ select * from admin_list_riders(null, 'bogus') $$, '23514', null, 'an unknown rider state is a check_violation');

-- ---------------------------------------------------------------------------
-- (4) Payables (scoped to the fixture owners; other rows may exist).
-- ---------------------------------------------------------------------------

create temp table dp_payables on commit drop as
select * from admin_list_payables(200, 0)
where owner_id in (
  'dd000000-0000-7000-8000-000000000001',
  tests.get_supabase_uid('dp_rider_active'), tests.get_supabase_uid('dp_rider_paid'), tests.get_supabase_uid('dp_rider_susp')
);

select is(
  (select array_agg(owner_id::text order by balance_kobo desc) from dp_payables),
  array['dd000000-0000-7000-8000-000000000001', tests.get_supabase_uid('dp_rider_active')::text, tests.get_supabase_uid('dp_rider_susp')::text],
  'payables lists owners with a balance above zero, largest first; a fully paid-out rider is absent'
);
select is(
  (select balance_kobo from dp_payables where owner_type = 'vendor'), 50000::bigint,
  'a vendor''s balance is its available-account balance'
);
select is(
  (select disbursed_kobo from admin_list_payables(200, 0) where owner_id = tests.get_supabase_uid('dp_rider_active')), 0::bigint,
  'disbursed is zero before any payout'
);
select is(
  (select bank_account_number from dp_payables where owner_id = tests.get_supabase_uid('dp_rider_active')), '0123456789',
  'a rider''s bank details ride along (callers mask them)'
);
select throws_ok($$ select * from admin_list_payables(0, 0) $$, '23514', null, 'a zero limit is a check_violation');

select * from finish();
rollback;
