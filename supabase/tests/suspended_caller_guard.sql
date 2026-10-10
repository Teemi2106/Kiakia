-- pgTAP: 0082_suspended_caller_guard.sql. A suspended account's still-valid
-- access token is refused by every guarded rider/customer/vendor RPC (42501),
-- an active account is not, and a caller with no profile row fails closed.
-- The one exception is a suspended rider finishing a delivery already picked up
-- (picked_up / in_transit / arrived), and the deferred session revocation that
-- goes with it.
--
-- "Not refused by the guard" is asserted as "did not raise 42501": the active
-- calls below use ids that make the function fail later for an unrelated
-- reason, which is enough to prove the guard let them through.

begin;
select plan(56);

create function pg_temp.sqlstate_of(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- auth.sessions is not readable by the roles the assertions run as.
create function pg_temp.session_count(p_user uuid)
returns int
language sql
security definer
as $$
  select count(*)::int from auth.sessions where user_id = p_user;
$$;

-- ---------------------------------------------------------------------------
-- The guard and its helpers are reachable by nobody.
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege(r.role, f.sig, 'execute'),
          format('%s cannot execute %s', r.role, f.sig))
from (values ('_assert_active_caller(boolean, uuid)'), ('_rider_in_progress(uuid, uuid)'), ('_order_in_progress(order_status)')) as f(sig)
cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role);

-- ---------------------------------------------------------------------------
-- Fixtures (as the owner).
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('sc_rider');
select tests.create_supabase_user('sc_rider_susp');
select tests.create_supabase_user('sc_rider_idle');
select tests.create_supabase_user('sc_rider_defer');
select tests.create_supabase_user('sc_rider_defer2');
select tests.create_supabase_user('sc_rider_quiet');
select tests.create_supabase_user('sc_customer');
select tests.create_supabase_user('sc_customer_susp');
select tests.create_supabase_user('sc_vendor_owner');
select tests.create_supabase_user('sc_vendor_susp');
select tests.create_supabase_user('sc_admin');
select tests.create_supabase_user('sc_no_profile');

insert into user_roles (user_id, role) values (tests.get_supabase_uid('sc_admin'), 'admin');

insert into riders (user_id, is_online, kyc_status) values
  (tests.get_supabase_uid('sc_rider'), true, 'approved'),
  (tests.get_supabase_uid('sc_rider_susp'), true, 'approved'),
  (tests.get_supabase_uid('sc_rider_idle'), true, 'approved'),
  (tests.get_supabase_uid('sc_rider_defer'), true, 'approved'),
  (tests.get_supabase_uid('sc_rider_defer2'), true, 'approved'),
  (tests.get_supabase_uid('sc_rider_quiet'), true, 'approved'),
  (tests.get_supabase_uid('sc_no_profile'), false, 'approved');

update profiles set status = 'suspended'
where id in (
  tests.get_supabase_uid('sc_rider_susp'), tests.get_supabase_uid('sc_rider_idle'),
  tests.get_supabase_uid('sc_customer_susp'), tests.get_supabase_uid('sc_vendor_susp')
);
delete from profiles where id = tests.get_supabase_uid('sc_no_profile');

insert into vendors (id, owner_user_id, name, slug, status, commission_bps)
values ('5c000000-0000-7000-8000-000000000001', tests.get_supabase_uid('sc_vendor_owner'), 'SC Vendor', 'sc-vendor', 'active', 1500);

insert into vendor_staff (vendor_id, user_id, role) values
  ('5c000000-0000-7000-8000-000000000001', tests.get_supabase_uid('sc_vendor_owner'), 'vendor_owner'),
  ('5c000000-0000-7000-8000-000000000001', tests.get_supabase_uid('sc_vendor_susp'), 'vendor_staff')
on conflict do nothing;

-- 11 suspended customer, placed        12 active customer, placed
-- 13 suspended rider, rider_assigned   14 active rider, rider_assigned
-- 15 suspended rider, picked_up        16 suspended rider, arrived (escrow funded, code 4321)
-- 17 idle suspended rider, rider_assigned
-- 18, 19 placed, for the suspended / active vendor staff
-- 21 deferring rider, in_transit       22 second deferring rider, picked_up
insert into orders (id, customer_id, vendor_id, rider_id, status, payment_status,
                    subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo, rider_fee_kobo,
                    delivery_address, delivery_location, arrived_at)
select o.id::uuid, tests.get_supabase_uid(o.customer), '5c000000-0000-7000-8000-000000000001',
       case when o.rider is null then null else tests.get_supabase_uid(o.rider) end,
       o.status::order_status, 'paid', 80000, 15000, 5000, 0, 100000, 15000,
       '{"line1": "1 SC Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'),
       case when o.status = 'arrived' then now() - interval '5 minutes' end
from (values
  ('5c000000-0000-7000-8000-000000000011', 'sc_customer_susp', null, 'placed'),
  ('5c000000-0000-7000-8000-000000000012', 'sc_customer', null, 'placed'),
  ('5c000000-0000-7000-8000-000000000013', 'sc_customer', 'sc_rider_susp', 'rider_assigned'),
  ('5c000000-0000-7000-8000-000000000014', 'sc_customer', 'sc_rider', 'rider_assigned'),
  ('5c000000-0000-7000-8000-000000000015', 'sc_customer', 'sc_rider_susp', 'picked_up'),
  ('5c000000-0000-7000-8000-000000000016', 'sc_customer', 'sc_rider_susp', 'arrived'),
  ('5c000000-0000-7000-8000-000000000017', 'sc_customer', 'sc_rider_idle', 'rider_assigned'),
  ('5c000000-0000-7000-8000-000000000018', 'sc_customer', null, 'placed'),
  ('5c000000-0000-7000-8000-000000000019', 'sc_customer', null, 'placed'),
  ('5c000000-0000-7000-8000-000000000021', 'sc_customer', 'sc_rider_defer', 'in_transit'),
  ('5c000000-0000-7000-8000-000000000022', 'sc_customer', 'sc_rider_defer2', 'picked_up')
) as o(id, customer, rider, status);

insert into order_delivery_codes (order_id, code) values ('5c000000-0000-7000-8000-000000000016', '4321');

insert into transactions (id, kind, reference, order_id, description)
values ('5c000000-0000-7000-8000-000000000116', 'payment_capture', 'SC-CAPTURE-016',
        '5c000000-0000-7000-8000-000000000016', 'fixture capture');
insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
select '5c000000-0000-7000-8000-000000000116', a.id, case when a.kind = 'gateway' then 'debit' else 'credit' end,
       100000, 'payment_capture', '5c000000-0000-7000-8000-000000000016'
from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind in ('gateway', 'escrow');

-- ---------------------------------------------------------------------------
-- A suspended rider is refused everywhere except finishing a delivery that is
-- already picked up.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('sc_rider_susp');

select throws_ok($$ select set_rider_online(true) $$, '42501', null,
  'suspended rider: set_rider_online(true) refused');
select throws_ok($$ select set_rider_online(false) $$, '42501', null,
  'suspended rider: set_rider_online(false) refused, even mid-delivery');
select throws_ok($$ select accept_dispatch_offer('5c000000-0000-7000-8000-000000000099') $$, '42501', null,
  'suspended rider: accept_dispatch_offer refused');
select throws_ok($$ select decline_dispatch_offer('5c000000-0000-7000-8000-000000000099') $$, '42501', null,
  'suspended rider: decline_dispatch_offer refused');
select throws_ok(
  format($$ select submit_rider_document('government_id', '%s/id.png') $$, tests.get_supabase_uid('sc_rider_susp')),
  '42501', null, 'suspended rider: submit_rider_document refused');
select throws_ok(
  format($$ select transition_order('5c000000-0000-7000-8000-000000000013', 'picked_up', 'rider', '%s') $$,
         tests.get_supabase_uid('sc_rider_susp')),
  '42501', null, 'suspended rider: an unpicked rider_assigned order cannot move to picked_up, even with another delivery in progress');
select throws_ok($$ select verify_delivery_and_release_escrow('5c000000-0000-7000-8000-000000000013', '4321') $$,
  '42501', null, 'suspended rider: verify_delivery_and_release_escrow refused on an order not yet picked up');

select lives_ok(
  format($$ select transition_order('5c000000-0000-7000-8000-000000000015', 'in_transit', 'rider', '%s') $$,
         tests.get_supabase_uid('sc_rider_susp')),
  'suspended rider: picked_up -> in_transit allowed on a delivery in progress');
select lives_ok(
  format($$ select transition_order('5c000000-0000-7000-8000-000000000015', 'arrived', 'rider', '%s') $$,
         tests.get_supabase_uid('sc_rider_susp')),
  'suspended rider: in_transit -> arrived allowed on a delivery in progress');
select lives_ok($$ select update_rider_location(9.05, 7.45) $$,
  'suspended rider: update_rider_location allowed while a delivery is in progress');
select ok(
  (select r.code_matched and (r.order_row).status = 'delivered'
   from verify_delivery_and_release_escrow('5c000000-0000-7000-8000-000000000016', '4321') r),
  'suspended rider: verify_delivery_and_release_escrow completes an arrived order');

select tests.authenticate_as('sc_rider_idle');

select throws_ok($$ select update_rider_location(9.05, 7.45) $$, '42501', null,
  'suspended rider with nothing in progress: update_rider_location refused');
select throws_ok(
  format($$ select transition_order('5c000000-0000-7000-8000-000000000017', 'picked_up', 'rider', '%s') $$,
         tests.get_supabase_uid('sc_rider_idle')),
  '42501', null, 'suspended rider with nothing in progress: transition_order refused');

-- ---------------------------------------------------------------------------
-- A suspended customer is refused.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('sc_customer_susp');

select throws_ok($$ select pay_order_from_wallet('5c000000-0000-7000-8000-000000000011') $$, '42501', null,
  'suspended customer: pay_order_from_wallet refused');
select throws_ok(
  format($$ select transition_order('5c000000-0000-7000-8000-000000000011', 'cancelled_by_customer', 'customer', '%s') $$,
         tests.get_supabase_uid('sc_customer_susp')),
  '42501', null, 'suspended customer: transition_order cancel refused');
select throws_ok($$ select register_vendor('SC Shop', 'sc-shop', 'restaurant') $$, '42501', null,
  'suspended user: register_vendor refused');

-- ---------------------------------------------------------------------------
-- Suspended vendor staff are refused.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('sc_vendor_susp');

select throws_ok(
  format($$ select transition_order('5c000000-0000-7000-8000-000000000018', 'accepted', 'vendor', '%s') $$,
         tests.get_supabase_uid('sc_vendor_susp')),
  '42501', null, 'suspended vendor staff: transition_order refused');
select throws_ok($$ select set_vendor_location('5c000000-0000-7000-8000-000000000001', 9.05, 7.45) $$, '42501', null,
  'suspended vendor staff: set_vendor_location refused');
select throws_ok($$ select * from get_vendor_order_customers(array['5c000000-0000-7000-8000-000000000018']::uuid[]) $$, '42501', null,
  'suspended vendor staff: get_vendor_order_customers refused');

-- ---------------------------------------------------------------------------
-- Active accounts get through the guard.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('sc_vendor_owner');

select lives_ok(
  format($$ select transition_order('5c000000-0000-7000-8000-000000000019', 'accepted', 'vendor', '%s') $$,
         tests.get_supabase_uid('sc_vendor_owner')),
  'active vendor staff: transition_order accepted works');
select lives_ok($$ select set_vendor_location('5c000000-0000-7000-8000-000000000001', 9.05, 7.45) $$,
  'active vendor staff: set_vendor_location works');
select is((select count(*)::int from get_vendor_order_customers(array['5c000000-0000-7000-8000-000000000019']::uuid[])), 1,
  'active vendor staff: get_vendor_order_customers works');

select tests.authenticate_as('sc_rider');

select lives_ok($$ select set_rider_online(false) $$, 'active rider: set_rider_online works');
select isnt(pg_temp.sqlstate_of($$ select accept_dispatch_offer('5c000000-0000-7000-8000-000000000099') $$), '42501',
  'active rider: accept_dispatch_offer passes the guard');
select isnt(pg_temp.sqlstate_of($$ select decline_dispatch_offer('5c000000-0000-7000-8000-000000000099') $$), '42501',
  'active rider: decline_dispatch_offer passes the guard');
select lives_ok(
  format($$ select transition_order('5c000000-0000-7000-8000-000000000014', 'picked_up', 'rider', '%s') $$,
         tests.get_supabase_uid('sc_rider')),
  'active rider: transition_order picked_up works');
select isnt(pg_temp.sqlstate_of($$ select verify_delivery_and_release_escrow('5c000000-0000-7000-8000-000000000014', '1234') $$),
  '42501', 'active rider: verify_delivery_and_release_escrow passes the guard');

select tests.authenticate_as('sc_customer');

select isnt(pg_temp.sqlstate_of($$ select pay_order_from_wallet('5c000000-0000-7000-8000-000000000012') $$), '42501',
  'active customer: pay_order_from_wallet passes the guard');
select isnt(pg_temp.sqlstate_of($$ select register_vendor('SC Shop', 'sc-shop', 'restaurant') $$), '42501',
  'active user: register_vendor passes the guard');
select lives_ok(
  format($$ select transition_order('5c000000-0000-7000-8000-000000000012', 'cancelled_by_customer', 'customer', '%s') $$,
         tests.get_supabase_uid('sc_customer')),
  'active customer: transition_order cancel works');

-- ---------------------------------------------------------------------------
-- Fail closed: a caller with no profile row.
-- ---------------------------------------------------------------------------

select tests.authenticate_as('sc_no_profile');

select throws_ok($$ select set_rider_online(false) $$, '42501', null,
  'a caller with no profile row is refused');

-- ---------------------------------------------------------------------------
-- Suspending: sessions are revoked at once, except for a rider on a delivery in
-- progress, whose sessions go when that delivery ends.
-- ---------------------------------------------------------------------------

reset role;
insert into auth.sessions (id, user_id) values
  ('5c000000-0000-7000-8000-0000000005e1', tests.get_supabase_uid('sc_rider_defer')),
  ('5c000000-0000-7000-8000-0000000005e2', tests.get_supabase_uid('sc_rider_defer2')),
  ('5c000000-0000-7000-8000-0000000005e3', tests.get_supabase_uid('sc_rider_quiet'));
select tests.authenticate_as_service_role();

select is(
  admin_set_user_status(tests.get_supabase_uid('sc_rider_quiet'), 'suspended', 'idle', tests.get_supabase_uid('sc_admin')),
  '{"status": "suspended", "previous_status": "active", "changed": true}'::jsonb,
  'suspending a rider with nothing in progress reports no deferral');
select is(pg_temp.session_count(tests.get_supabase_uid('sc_rider_quiet')), 0,
  'and deletes their sessions immediately');

select is(
  admin_set_user_status(tests.get_supabase_uid('sc_rider_defer'), 'suspended', 'fraud', tests.get_supabase_uid('sc_admin')),
  '{"status": "suspended", "previous_status": "active", "changed": true, "sign_in_ban_deferred": true}'::jsonb,
  'suspending a rider mid-delivery reports the sign-in ban as deferred');
select is(pg_temp.session_count(tests.get_supabase_uid('sc_rider_defer')), 1,
  'and keeps their sessions');
select is((select is_online from riders where user_id = tests.get_supabase_uid('sc_rider_defer')), false,
  'but still takes them offline');
select is(
  admin_set_user_status(tests.get_supabase_uid('sc_rider_defer2'), 'suspended', 'fraud', tests.get_supabase_uid('sc_admin')),
  '{"status": "suspended", "previous_status": "active", "changed": true, "sign_in_ban_deferred": true}'::jsonb,
  'a second rider mid-delivery is deferred too');

select tests.authenticate_as('sc_rider_defer');

select lives_ok(
  format($$ select transition_order('5c000000-0000-7000-8000-000000000021', 'arrived', 'rider', '%s') $$,
         tests.get_supabase_uid('sc_rider_defer')),
  'the deferred rider can still mark the order arrived');
select is(pg_temp.session_count(tests.get_supabase_uid('sc_rider_defer')), 1,
  'their sessions survive while the order is still in progress');
select tests.authenticate_as('sc_rider_defer');
select lives_ok(
  format($$ select transition_order('5c000000-0000-7000-8000-000000000021', 'failed_delivery', 'rider', '%s') $$,
         tests.get_supabase_uid('sc_rider_defer')),
  'and can end the delivery');
select is(pg_temp.session_count(tests.get_supabase_uid('sc_rider_defer')), 0,
  'ending the delivery revokes their sessions');

select tests.authenticate_as_service_role();
select lives_ok(
  format($$ select transition_order('5c000000-0000-7000-8000-000000000022', 'cancelled_by_platform', 'admin', '%s') $$,
         tests.get_supabase_uid('sc_admin')),
  'an admin cancels the other rider''s delivery');
select is(pg_temp.session_count(tests.get_supabase_uid('sc_rider_defer2')), 0,
  'cancelling it revokes their sessions');
select is(
  admin_set_user_status(tests.get_supabase_uid('sc_rider_defer'), 'suspended', 'fraud again', tests.get_supabase_uid('sc_admin')),
  '{"status": "suspended", "previous_status": "suspended", "changed": false}'::jsonb,
  'resubmitting the suspension afterwards reports nothing deferred, so the action can apply the ban');

-- ---------------------------------------------------------------------------
-- State left behind by the calls above.
-- ---------------------------------------------------------------------------

select is((select status::text from orders where id = '5c000000-0000-7000-8000-000000000013'), 'rider_assigned',
  'the suspended rider''s unpicked order did not move');
select is((select status::text from orders where id = '5c000000-0000-7000-8000-000000000014'), 'picked_up',
  'the active rider''s order moved to picked_up');
select is((select status::text from orders where id = '5c000000-0000-7000-8000-000000000018'), 'placed',
  'the suspended vendor staff''s order did not move');

select * from finish();
rollback;
