-- pgTAP: vendor self-delivery (0098) - the vendor chooses to deliver an order
-- itself instead of waiting for a rider.
--
-- What this protects, in order of how bad getting it wrong would be:
-- (1) MONEY. A vendor-delivered order releases escrow exactly once, with the
--     split: vendor = (subtotal - commission) + the order's delivery fee, rider =
--     nobody (no rider account touched, rider_fee_kobo stays 0), platform = the
--     residual; the ledger balances and admin_money_summary still reconciles.
-- (2) PROOF OF DELIVERY. The customer's code is checked by the SAME shared
--     routine as the rider path: 5 wrong guesses lock it, an admin reset
--     unlocks it, a replay never pays twice.
-- (3) WHO MAY DO WHAT. Only staff of the order's own vendor, active account, only
--     for a rider-less paid order that has not been picked up; a vendor can drive
--     picked_up..arrived only on its own vendor-delivered orders; riders and the
--     admin dispatch tools refuse such orders; dispatch ignores them.
-- (4) REFUNDS still work for vendor-delivered orders.
--
-- Fixture money: subtotal 500000, delivery fee 50000, service fee 10000,
-- total 560000, commission 15% (75000). Vendor gets 425000 + 50000 = 475000,
-- platform 85000, rider 0.

begin;
select no_plan();

create temp table res (k text primary key, v jsonb);
grant all on res to public;

select tests.create_supabase_user('sd_customer');
select tests.create_supabase_user('sd_v1');
select tests.create_supabase_user('sd_v2');
select tests.create_supabase_user('sd_rider');
select tests.create_supabase_user('sd_rider2');
select tests.create_supabase_user('sd_admin');
select tests.create_supabase_user('sd_stranger');
insert into user_roles (user_id, role) values (tests.get_supabase_uid('sd_admin'), 'admin');

insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
values ('ff000000-0000-7000-8000-000000000201', 'SD Area', st_geogfromtext('POLYGON((7.0 9.0, 8.5 9.0, 8.5 10.0, 7.0 10.0, 7.0 9.0))'), true, 50000, 15000, 50000, 15000);

insert into vendors (id, owner_user_id, name, slug, status, location, commission_bps, delivery_radius_m) values
  ('ff000000-0000-7000-8000-000000000101', tests.get_supabase_uid('sd_v1'), 'SD Kitchen', 'sd-kitchen', 'active', st_geogfromtext('POINT(7.5 9.5)'), 1500, 20000),
  ('ff000000-0000-7000-8000-000000000102', tests.get_supabase_uid('sd_v2'), 'SD Other', 'sd-other', 'active', st_geogfromtext('POINT(7.5 9.5)'), 1500, 20000);
insert into vendor_staff (vendor_id, user_id, role) values
  ('ff000000-0000-7000-8000-000000000101', tests.get_supabase_uid('sd_v1'), 'vendor_owner'),
  ('ff000000-0000-7000-8000-000000000102', tests.get_supabase_uid('sd_v2'), 'vendor_owner')
on conflict do nothing;

insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
values (tests.get_supabase_uid('sd_rider'), true, 'approved', st_geogfromtext('POINT(7.505 9.5)'), now());
-- Sequential dispatch (0100+) asks ONE rider per order and a rider already holding a live offer is not asked for a second
-- order. With a lone rider the early-dispatch offer on order 05 left nobody for the rider-delivered control order 06, which
-- the sweep then gave up on after 30 minutes (and cancelled) - hiding what its assertion means to check (vendor actions
-- leave a rider-delivered order alone). A second rider restores "both dispatchable orders get a rider to ask".
insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
values (tests.get_supabase_uid('sd_rider2'), true, 'approved', st_geogfromtext('POINT(7.51 9.5)'), now());

-- p_n: order suffix. Creates a paid order with its delivery code '4321' and a
-- balanced payment capture into escrow.
create function pg_temp.mk_order(p_n text, p_status order_status, p_paid boolean default true, p_rider boolean default false)
returns void language plpgsql as $$
declare
  v_id uuid := ('ff000000-0000-7000-8000-0000000003' || p_n)::uuid;
  v_tx uuid := ('ff000000-0000-7000-8000-0000000004' || p_n)::uuid;
begin
  insert into orders (id, customer_id, vendor_id, service_area_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo,
                      discount_kobo, total_kobo, delivery_address, delivery_location, rider_id, accepted_at, ready_at, first_dispatched_at,
                      arrived_at)
  values (v_id, tests.get_supabase_uid('sd_customer'), 'ff000000-0000-7000-8000-000000000101', 'ff000000-0000-7000-8000-000000000201',
          p_status, case when p_paid then 'paid' else 'pending' end, 500000, 50000, 10000, 0, 560000,
          '{"line1": "1 SD Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'),
          case when p_rider then tests.get_supabase_uid('sd_rider') end,
          now() - interval '40 minutes', case when p_status = 'ready_for_pickup' then now() - interval '35 minutes' end,
          case when p_status = 'ready_for_pickup' then now() - interval '35 minutes' end,
          case when p_status = 'arrived' then now() - interval '1 minute' end);
  insert into order_delivery_codes (order_id, code) values (v_id, '4321');
  if p_paid then
    insert into transactions (id, kind, reference, order_id, description) values (v_tx, 'payment_capture', 'SD-CAP-' || p_n, v_id, 'fixture capture');
    insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
    select v_tx, a.id, 'debit', 560000, 'payment_capture', v_id from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'gateway';
    insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
    select v_tx, a.id, 'credit', 560000, 'payment_capture', v_id from accounts a where a.owner_type = 'platform' and a.owner_id is null and a.kind = 'escrow';
  end if;
end;
$$;
create function pg_temp.oid(p_n text) returns uuid language sql as $$ select ('ff000000-0000-7000-8000-0000000003' || p_n)::uuid $$;

insert into res select 'money_before', admin_money_summary();

-- ---------------------------------------------------------------------------
-- Starting self-delivery
-- ---------------------------------------------------------------------------

select pg_temp.mk_order('01', 'ready_for_pickup');
insert into dispatch_offers (order_id, rider_id, cycle_no, attempt_no) values (pg_temp.oid('01'), tests.get_supabase_uid('sd_rider'), 1, 1);
select pg_temp.mk_order('02', 'ready_for_pickup', true, true);     -- has a rider
select pg_temp.mk_order('03', 'placed');
select pg_temp.mk_order('04', 'ready_for_pickup', false);          -- unpaid
select pg_temp.mk_order('05', 'preparing');                        -- will be driven by the vendor
select pg_temp.mk_order('06', 'ready_for_pickup');                 -- rider-delivered control

select tests.authenticate_as('sd_stranger');
select throws_ok(format($$ select vendor_start_self_delivery(%L::uuid) $$, pg_temp.oid('01')), '42501', null, 'a non-staff user is refused');
select tests.authenticate_as('sd_v2');
select throws_ok(format($$ select vendor_start_self_delivery(%L::uuid) $$, pg_temp.oid('01')), '42501', null, 'another vendor''s staff is refused');
select tests.authenticate_as('sd_v1');
select throws_ok(format($$ select vendor_start_self_delivery(%L::uuid) $$, pg_temp.oid('02')), '23514', null, 'refused when a rider is already assigned');
select throws_ok(format($$ select vendor_start_self_delivery(%L::uuid) $$, pg_temp.oid('03')), '23514', null, 'refused for an order that is not accepted/preparing/ready');
select throws_ok(format($$ select vendor_start_self_delivery(%L::uuid) $$, pg_temp.oid('04')), '23514', null, 'refused for an unpaid order');
reset role;
update profiles set status = 'suspended' where id = tests.get_supabase_uid('sd_v1');
select tests.authenticate_as('sd_v1');
select throws_ok(format($$ select vendor_start_self_delivery(%L::uuid) $$, pg_temp.oid('01')), '42501', null, 'a suspended vendor account is refused');
reset role;
update profiles set status = 'active' where id = tests.get_supabase_uid('sd_v1');
select is((select delivery_by from orders where id = pg_temp.oid('01')), 'rider', 'refusals changed nothing');

select tests.authenticate_as('sd_v1');
insert into res select 'start1', vendor_start_self_delivery(pg_temp.oid('01'));
insert into res select 'start1b', vendor_start_self_delivery(pg_temp.oid('01'));
reset role;
select is((select v from res where k = 'start1'), format('{"order_id": "%s", "status": "ready_for_pickup", "delivery_by": "vendor", "changed": true, "offers_closed": 1}', pg_temp.oid('01'))::jsonb, 'start: marks vendor delivery and reports the closed offer');
select is((select (v ->> 'changed')::boolean from res where k = 'start1b'), false, 'start is idempotent');
select is((select delivery_by from orders where id = pg_temp.oid('01')), 'vendor', 'orders.delivery_by = vendor');
select is((select status from dispatch_offers where order_id = pg_temp.oid('01')), 'cancelled', 'the open offer is closed (cancelled; was revoked before 0100 - revoked now only means an operator took an ACCEPTED order off a rider)');
select is((select close_reason from dispatch_offers where order_id = pg_temp.oid('01')), 'vendor_self_delivery', '... with the reason vendor_self_delivery');
select is((select count(*) from order_events where order_id = pg_temp.oid('01') and actor_type = 'vendor' and meta @> '{"delivery_by": "vendor"}'), 1::bigint, 'one order_events row, actor vendor, meta delivery_by vendor');
select is((select body from notifications where order_id = pg_temp.oid('01') and customer_id is not null),
  format('SD Kitchen will deliver your order %s themselves.', (select code from orders where id = pg_temp.oid('01'))), 'the customer is told once');
select is((select count(*) from notifications where order_id = pg_temp.oid('01') and customer_id is not null), 1::bigint, 'no second notice on replay');

-- Rider side.
select tests.authenticate_as('sd_rider');
select throws_like(format($$ select accept_dispatch_offer(%L::uuid) $$, pg_temp.oid('01')), '%delivered by the vendor%', 'accept_dispatch_offer refuses with a clear message');
select throws_ok(format($$ select verify_delivery_and_release_escrow(%L::uuid, '4321') $$, pg_temp.oid('01')), 'P0001', null, 'a rider cannot complete a vendor-delivered order');
select throws_ok(format($$ select transition_order(%L::uuid, 'picked_up', 'rider', %L::uuid) $$, pg_temp.oid('01'), tests.get_supabase_uid('sd_rider')), 'P0001', null, 'a rider cannot drive it');
reset role;

-- Dispatch ignores it, and does not cancel it after 30 minutes.
select tests.authenticate_as_service_role();
select * from sweep_dispatch_offers();
select * from dispatch_orders_nearing_prep_completion();
select ok(not exists (select 1 from jsonb_array_elements(admin_dispatch_status() -> 'stuck_orders') e where e ->> 'order_id' = pg_temp.oid('01')::text),
  'admin_dispatch_status does not list a vendor-delivered order');
select throws_ok(format($$ select admin_redispatch_order(%L::uuid, 'x', %L::uuid) $$, pg_temp.oid('01'), tests.get_supabase_uid('sd_admin')), '23514', null, 'admin redispatch refuses it');
select throws_ok(format($$ select admin_reassign_order_rider(%L::uuid, %L::uuid, 'x', %L::uuid) $$, pg_temp.oid('01'), tests.get_supabase_uid('sd_rider'), tests.get_supabase_uid('sd_admin')), '23514', null, 'admin force-assign refuses it');
reset role;
select is((select status::text from orders where id = pg_temp.oid('01')), 'ready_for_pickup', 'the 35-minute-old vendor-delivered order was not given up on by the sweep');
select is((select count(*) from dispatch_offers where order_id = pg_temp.oid('01') and status = 'offered'), 0::bigint, 'dispatch created no new offers for it');

select tests.authenticate_as('sd_v1');
select throws_ok(format($$ select vendor_expand_rider_search(%L::uuid) $$, pg_temp.oid('01')), '23514', null, 'expanding the rider search on a vendor-delivered order is refused');
select is((vendor_dispatch_state(pg_temp.oid('01')) ->> 'state'), 'self_delivery', 'vendor_dispatch_state: self_delivery');
select is((vendor_dispatch_state(pg_temp.oid('02')) ->> 'state'), 'rider_assigned', 'vendor_dispatch_state: rider_assigned');
reset role;

-- A vendor-delivered order that is still being cooked: the vendor drives it with the normal transitions; the ready transition does not dispatch.
select tests.authenticate_as('sd_v1');
select vendor_start_self_delivery(pg_temp.oid('05'));
select transition_order(pg_temp.oid('05'), 'ready_for_pickup', 'vendor', tests.get_supabase_uid('sd_v1'));
reset role;
select is((select count(*) from dispatch_offers where order_id = pg_temp.oid('05') and status = 'offered'), 0::bigint, 'marking a vendor-delivered order ready leaves no live offers (the early-dispatch offer made before the choice was revoked)');

-- ---------------------------------------------------------------------------
-- State path
-- ---------------------------------------------------------------------------

select tests.authenticate_as('sd_v1');
select throws_ok(format($$ select vendor_advance_self_delivery(%L::uuid, 'arrived') $$, pg_temp.oid('01')), '23514', null, 'cannot skip ahead (ready -> arrived)');
select throws_ok(format($$ select vendor_advance_self_delivery(%L::uuid, 'delivered') $$, pg_temp.oid('01')), '23514', null, 'delivered is not an advance target (only the code completes it)');
select throws_ok(format($$ select vendor_advance_self_delivery(%L::uuid, 'picked_up') $$, pg_temp.oid('06')), '23514', null, 'a rider-delivered order cannot be advanced by the vendor');
select throws_ok(format($$ select transition_order(%L::uuid, 'picked_up', 'vendor', %L::uuid) $$, pg_temp.oid('06'), tests.get_supabase_uid('sd_v1')), 'P0001', null, 'transition_order still refuses vendor -> picked_up on a rider-delivered order');
reset role;
select tests.authenticate_as('sd_v2');
select throws_ok(format($$ select vendor_advance_self_delivery(%L::uuid, 'picked_up') $$, pg_temp.oid('01')), '42501', null, 'another vendor cannot advance it');
reset role;

select tests.authenticate_as('sd_v1');
insert into res select 'adv1', vendor_advance_self_delivery(pg_temp.oid('01'), 'picked_up');
insert into res select 'adv2', vendor_advance_self_delivery(pg_temp.oid('01'), 'in_transit');
insert into res select 'adv3', vendor_advance_self_delivery(pg_temp.oid('01'), 'arrived');
reset role;
select is((select v ->> 'status' from res where k = 'adv3'), 'arrived', 'ready -> picked_up -> in_transit -> arrived');
select is((select array_agg(body order by created_at, id) from notifications where order_id = pg_temp.oid('01') and customer_id is not null and title <> 'Delivery update'),
  array[format('SD Kitchen has set off with your order %1$s.', (select code from orders where id = pg_temp.oid('01'))),
        format('Your order %1$s is on the way!', (select code from orders where id = pg_temp.oid('01'))),
        format('SD Kitchen has arrived with order %1$s.', (select code from orders where id = pg_temp.oid('01')))],
  'customer notifications are worded for a vendor delivery (no "rider")');
select is((select count(*) from notifications where order_id = pg_temp.oid('01') and vendor_id is not null and title = 'Order picked up'), 0::bigint, 'the vendor is not told a rider collected its own order');
select is((select delivery_by || '/' || status::text from orders where id = pg_temp.oid('06')), 'rider/ready_for_pickup', 'the rider-delivered control order is untouched');

-- The customer can see who delivers.
select tests.authenticate_as('sd_customer');
select is((select t.delivery_by || '/' || t.vendor_name || '/' || coalesce(t.rider_name, 'none') from get_order_tracking(pg_temp.oid('01')) t), 'vendor/SD Kitchen/none',
  'get_order_tracking exposes delivery_by and the vendor name, no rider');
reset role;

-- ---------------------------------------------------------------------------
-- Completion: code check, lockout, reset, ledger split, replay
-- ---------------------------------------------------------------------------

select tests.authenticate_as('sd_v2');
select throws_ok(format($$ select vendor_complete_self_delivery(%L::uuid, '4321') $$, pg_temp.oid('01')), '42501', null, 'another vendor cannot complete it');
select tests.authenticate_as('sd_stranger');
select throws_ok(format($$ select vendor_complete_self_delivery(%L::uuid, '4321') $$, pg_temp.oid('01')), '42501', null, 'a stranger cannot complete it');
select tests.authenticate_as('sd_v1');
select throws_ok(format($$ select vendor_complete_self_delivery(%L::uuid, '4321') $$, pg_temp.oid('06')), '23514', null, 'a rider-delivered order cannot be completed by the vendor');
reset role;

select tests.authenticate_as('sd_v1');
select is((select (vendor_complete_self_delivery(pg_temp.oid('01'), v) ->> 'code_matched')::boolean), false, format('wrong code %s: code_matched false', v))
from unnest(array['0000', '1111', '2222', '3333', '4444']) v;
select throws_like(format($$ select vendor_complete_self_delivery(%L::uuid, '4321') $$, pg_temp.oid('01')), '%too many incorrect%', 'after 5 wrong guesses even the right code is locked out');
reset role;
select is((select count(*) from transactions where reference = (select code from orders where id = pg_temp.oid('01')) || '-escrow'), 0::bigint, 'nothing was released while locked');
select is((select count(*) from order_events where order_id = pg_temp.oid('01') and actor_type = 'vendor' and (meta ->> 'delivery_code_failed')::boolean), 5::bigint, 'five failed attempts recorded against the vendor');

select tests.authenticate_as_service_role();
select admin_reset_delivery_code_attempts(pg_temp.oid('01'), tests.get_supabase_uid('sd_admin'), 'customer confirmed the code by phone');
reset role;

select tests.authenticate_as('sd_v1');
insert into res select 'done1', vendor_complete_self_delivery(pg_temp.oid('01'), '4321');
insert into res select 'done2', vendor_complete_self_delivery(pg_temp.oid('01'), '4321');
reset role;
select is((select v::text from res where k = 'done1'), '{"status": "delivered", "delivery_by": "vendor", "code_matched": true}', 'the right code after an admin reset delivers the order');
select is((select v ->> 'code_matched' from res where k = 'done2'), 'true', 'a replay is accepted');
select is((select count(*) from transactions where reference = (select code from orders where id = pg_temp.oid('01')) || '-escrow'), 1::bigint, 'escrow released exactly once');

select is((select coalesce(sum(le.amount_kobo), 0)::bigint from ledger_entries le join accounts a on a.id = le.account_id
           where le.order_id = pg_temp.oid('01') and le.entry_type = 'escrow_release' and le.direction = 'credit' and a.owner_type = 'vendor'),
  475000::bigint, 'vendor credited subtotal - commission (425000) + delivery fee (50000)');
select is((select coalesce(sum(le.amount_kobo), 0)::bigint from ledger_entries le join accounts a on a.id = le.account_id
           where le.order_id = pg_temp.oid('01') and le.entry_type = 'escrow_release' and le.direction = 'credit' and a.owner_type = 'platform' and a.kind = 'revenue'),
  85000::bigint, 'platform keeps the residual (commission + service fee)');
select is((select count(*) from ledger_entries le join accounts a on a.id = le.account_id
           where le.order_id = pg_temp.oid('01') and le.entry_type = 'escrow_release' and a.owner_type = 'rider'), 0::bigint, 'no rider account is credited');
select is((select coalesce(sum(case when direction = 'debit' then amount_kobo else -amount_kobo end), 0)::bigint from ledger_entries
           where transaction_id = (select id from transactions where reference = (select code from orders where id = pg_temp.oid('01')) || '-escrow')),
  0::bigint, 'the release transaction balances');
select is((select rider_fee_kobo from orders where id = pg_temp.oid('01')), 0::bigint, 'rider_fee_kobo stays 0');
select is((select status::text from orders where id = pg_temp.oid('01')), 'delivered', 'order delivered');
select is((select body from notifications where order_id = pg_temp.oid('01') and vendor_id is not null and title = 'Order delivered'),
  format('Order %s was delivered. Your payout, including the delivery fee, has been released.', (select code from orders where id = pg_temp.oid('01'))),
  'the vendor is told the payout includes the delivery fee');

-- Money summary: reconciliation holds and the shares moved as expected.
insert into res select 'money_after', admin_money_summary();
select is((select (v -> 'reconciliation' ->> 'reconciles')::boolean from res where k = 'money_after'), true, 'admin_money_summary still reconciles with a vendor-delivered order');
select is((select (a.v ->> 'vendor_earned_kobo')::bigint - (b.v ->> 'vendor_earned_kobo')::bigint from res a, res b where a.k = 'money_after' and b.k = 'money_before'), 475000::bigint, 'vendor_earned grew by the vendor share + delivery fee');
select is((select (a.v ->> 'rider_earned_kobo')::bigint - (b.v ->> 'rider_earned_kobo')::bigint from res a, res b where a.k = 'money_after' and b.k = 'money_before'), 0::bigint, 'rider_earned did not move');
select is((select (a.v ->> 'platform_earnings_kobo')::bigint - (b.v ->> 'platform_earnings_kobo')::bigint from res a, res b where a.k = 'money_after' and b.k = 'money_before'), 85000::bigint, 'platform earnings grew by the residual');

-- ---------------------------------------------------------------------------
-- Refunds / cancellations for vendor-delivered orders
-- ---------------------------------------------------------------------------

select pg_temp.mk_order('11', 'ready_for_pickup');
select pg_temp.mk_order('12', 'ready_for_pickup');
select tests.authenticate_as('sd_v1');
select vendor_start_self_delivery(pg_temp.oid('11'));
select vendor_start_self_delivery(pg_temp.oid('12'));
select vendor_advance_self_delivery(pg_temp.oid('12'), 'picked_up');
reset role;
select tests.authenticate_as_service_role();
select transition_order(pg_temp.oid('11'), 'cancelled_by_platform', 'admin', tests.get_supabase_uid('sd_admin'));
select transition_order(pg_temp.oid('12'), 'cancelled_by_platform', 'admin', tests.get_supabase_uid('sd_admin'));
reset role;
select is((select string_agg(payment_status, ',' order by id) from orders where id in (pg_temp.oid('11'), pg_temp.oid('12'))), 'refunded,refunded',
  'cancelling a vendor-delivered order before or after pick-up refunds the escrow');
select is((select count(*) from transactions where kind = 'refund' and order_id in (pg_temp.oid('11'), pg_temp.oid('12'))), 2::bigint, 'one refund transaction each');

-- Unrelated rider flow still intact (the shared core): covered in full by verify_delivery_and_release_escrow.sql.
select is((select delivery_by from orders where id = pg_temp.oid('02')), 'rider', 'orders default to rider delivery');

select * from finish();
rollback;
