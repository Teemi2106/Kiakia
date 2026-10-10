-- pgTAP: 0083_admin_dispatch_override.sql - admin_reassign_order_rider() and
-- admin_list_assignable_riders(), plus the accept_dispatch_offer() refactor onto
-- _quote_rider_fee().
--
-- What this protects, in order of how bad getting it wrong would be:
-- (1) NO DOUBLE ASSIGNMENT / NO STALE OFFERS. A forced assignment never lands on
--     a rider who is offline, stale, unapproved, suspended, or already holding
--     another active order; every other live offer is expired; a removed rider's
--     offer is 'revoked' and neither _dispatch_offer_batch() nor the sweep ever
--     re-offers it; their map position is gone.
-- (2) THE ORDER STATE. Only accepted / preparing / ready_for_pickup /
--     rider_assigned can be touched; picked_up onward, terminal and pre-payment
--     statuses are refused. A re-offer from rider_assigned goes back to
--     ready_for_pickup and restarts the rider clock without touching ready_at.
-- (3) MONEY IS UNTOUCHED, and the fee an admin assignment freezes equals what
--     the rider's own accept would have computed.
-- (4) AUDIT. One admin_audit_log row and one order_events row per real change; a
--     refusal or a no-op writes none.
--
-- The order lock (an admin override racing a rider's accept) cannot be exercised
-- inside one pgTAP transaction; see the CONCURRENCY note at the bottom.
--
-- Positions: the vendor is at POINT(7.5 9.5). "near" riders sit 549 m east of it
-- (fee 50000 + 15000 * 1 = 65000), ra sits on it (fee 50000), rh sits ~11 km
-- away (fee 215000, above the 135000 the order can fund).

begin;
select plan(96);

create temp table base_counts as select count(*)::int as ledger_entries from ledger_entries;
grant select on base_counts to service_role;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege(r.role, f.sig, 'execute'), format('%s cannot execute %s', r.role, f.sig))
from (values ('admin_reassign_order_rider(uuid, uuid, text, uuid)'), ('admin_list_assignable_riders(uuid, integer)')) as f(sig)
cross join (values ('anon'), ('authenticated')) as r(role);

select ok(has_function_privilege('service_role', f.sig, 'execute'), format('service_role can execute %s', f.sig))
from (values ('admin_reassign_order_rider(uuid, uuid, text, uuid)'), ('admin_list_assignable_riders(uuid, integer)')) as f(sig);

select ok(not has_function_privilege(r.role, f.sig, 'execute'), format('%s cannot execute %s', r.role, f.sig))
from (values ('_quote_rider_fee(uuid, uuid)'), ('_rider_assign_blocker(uuid, uuid)')) as f(sig)
cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role);

select ok(
  (select pg_get_triggerdef(oid) like '%WHEN%new.status = ''offered''%' from pg_trigger where tgname = 'dispatch_offers_notify_rider'),
  'the new-offer push only fires for rows inserted as offered (a forced assignment inserts an accepted one)'
);

-- ---------------------------------------------------------------------------
-- Fixtures (as the owner)
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('dd_admin');
select tests.create_supabase_user('dd_admin_susp');
select tests.create_supabase_user('dd_customer');
select tests.create_supabase_user('dd_vendor_owner');
select tests.create_supabase_user('dd_' || n) from unnest(array['ra','rb','rc','rd','re','rf','rg','rh','rj','rk','rl','rm','rn','ro']) as n;

insert into user_roles (user_id, role) values (tests.get_supabase_uid('dd_admin'), 'admin'), (tests.get_supabase_uid('dd_admin_susp'), 'admin');
update profiles set status = 'suspended' where id in (tests.get_supabase_uid('dd_admin_susp'), tests.get_supabase_uid('dd_rf'));

insert into vendors (id, owner_user_id, name, slug, status, location, commission_bps)
values ('dd000000-0000-7000-8000-000000000101', tests.get_supabase_uid('dd_vendor_owner'), 'DD Vendor', 'dd-vendor', 'active', st_geogfromtext('POINT(7.5 9.5)'), 1500);

insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
values ('dd000000-0000-7000-8000-000000000201', 'DD Area', st_geogfromtext('POLYGON((7.4 9.0, 7.8 9.0, 7.8 9.9, 7.4 9.9, 7.4 9.0))'), true, 50000, 15000, 50000, 15000);

-- All approved, online and freshly pinged unless stated.
insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
select tests.get_supabase_uid('dd_' || n), true, 'approved',
       st_geogfromtext(case n when 'ra' then 'POINT(7.5 9.5)' when 'rh' then 'POINT(7.6 9.5)' else 'POINT(7.505 9.5)' end),
       now()
from unnest(array['ra','rb','rc','rd','re','rf','rg','rh','rj','rk','rl','rm','rn','ro']) as n;
update riders set is_online = false where user_id = tests.get_supabase_uid('dd_rc');
update riders set last_ping_at = now() - interval '10 minutes' where user_id = tests.get_supabase_uid('dd_rd');
update riders set kyc_status = 'pending' where user_id = tests.get_supabase_uid('dd_re');

-- total 560000, subtotal 500000 at 15% commission: the order can fund a rider fee up to 135000.
create function pg_temp.mk_order(p_n text, p_status order_status, p_rider uuid default null, p_clocks boolean default false)
returns void language sql as $$
  insert into orders (id, customer_id, vendor_id, service_area_id, status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo, discount_kobo, total_kobo,
                      delivery_address, delivery_location, rider_id, rider_fee_kobo, assigned_at, ready_at, first_dispatched_at, dispatch_cycle_started_at)
  values (('dd000000-0000-7000-8000-0000000000' || p_n)::uuid, tests.get_supabase_uid('dd_customer'),
          'dd000000-0000-7000-8000-000000000101', 'dd000000-0000-7000-8000-000000000201', p_status,
          500000, 50000, 10000, 0, 560000, '{"line1": "1 DD Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'),
          p_rider, case when p_rider is null then 0 else 65000 end,
          case when p_rider is not null and p_status = 'rider_assigned' then now() - interval '1 hour' end,
          case when p_clocks then now() - interval '2 hours' end,
          case when p_clocks then now() - interval '1 hour' end,
          case when p_clocks then now() - interval '1 hour' end);
$$;

select pg_temp.mk_order('01', 'rider_assigned', tests.get_supabase_uid('dd_ra'), true);
select pg_temp.mk_order('02', 'preparing', tests.get_supabase_uid('dd_rb'));
select pg_temp.mk_order('03', 'ready_for_pickup', null, true);
select pg_temp.mk_order('04', 'ready_for_pickup');
select pg_temp.mk_order('05', 'ready_for_pickup');
select pg_temp.mk_order('06', 'preparing');
select pg_temp.mk_order('07', 'preparing');
select pg_temp.mk_order('08', 'rider_assigned', tests.get_supabase_uid('dd_rn'));
select pg_temp.mk_order('09', 'ready_for_pickup');
select pg_temp.mk_order('10', 'preparing', tests.get_supabase_uid('dd_rg'));
select pg_temp.mk_order('11', 'ready_for_pickup');
select pg_temp.mk_order('12', 'picked_up');
select pg_temp.mk_order('13', 'in_transit');
select pg_temp.mk_order('14', 'arrived');
select pg_temp.mk_order('15', 'delivered');
select pg_temp.mk_order('16', 'cancelled_by_platform');
select pg_temp.mk_order('17', 'placed');

-- 01 rider_assigned ra   02 preparing (early accept) rb   03 ready, nobody offered, stale cycle
-- 04 ready, offers to rk/rl, assigned to rj   05 twin of 04: rk accepts   06 preparing twin of 07: rl early-accepts
-- 07 preparing, assigned to rm   08 rider_assigned rn, swapped to ro   09 ready, refusal target
-- 10 preparing with rg (rg is "busy")   11 ready, offered to far rh   12-17 refused statuses
insert into dispatch_offers (order_id, rider_id, status, responded_at) values
  ('dd000000-0000-7000-8000-000000000001'::uuid, tests.get_supabase_uid('dd_ra'), 'accepted', now()), ('dd000000-0000-7000-8000-000000000002'::uuid, tests.get_supabase_uid('dd_rb'), 'accepted', now()), ('dd000000-0000-7000-8000-000000000008'::uuid, tests.get_supabase_uid('dd_rn'), 'accepted', now());
insert into dispatch_offers (order_id, rider_id, status) values
  ('dd000000-0000-7000-8000-000000000004'::uuid, tests.get_supabase_uid('dd_rk'), 'offered'), ('dd000000-0000-7000-8000-000000000004'::uuid, tests.get_supabase_uid('dd_rl'), 'offered'), ('dd000000-0000-7000-8000-000000000005'::uuid, tests.get_supabase_uid('dd_rk'), 'offered'), ('dd000000-0000-7000-8000-000000000006'::uuid, tests.get_supabase_uid('dd_rl'), 'offered'), ('dd000000-0000-7000-8000-000000000011'::uuid, tests.get_supabase_uid('dd_rh'), 'offered');
insert into order_rider_locations (order_id, rider_id, lat, lng) values ('dd000000-0000-7000-8000-000000000001'::uuid, tests.get_supabase_uid('dd_ra'), 9.5, 7.5), ('dd000000-0000-7000-8000-000000000008'::uuid, tests.get_supabase_uid('dd_rn'), 9.5, 7.505);

-- ---------------------------------------------------------------------------
-- Authorization, reason, status guards
-- ---------------------------------------------------------------------------

select tests.authenticate_as('dd_admin');
select throws_ok(
  format($$ select admin_reassign_order_rider(%L::uuid, null, 'x', %L::uuid) $$, 'dd000000-0000-7000-8000-000000000001', tests.get_supabase_uid('dd_admin')),
  '42501', null, 'an authenticated admin (not the service-role key) cannot call it directly'
);
select tests.clear_authentication();

select tests.authenticate_as_service_role();

select throws_ok(
  format($$ select admin_reassign_order_rider(%L::uuid, null, 'support call', %L::uuid) $$, 'dd000000-0000-7000-8000-000000000009', tests.get_supabase_uid('dd_customer')),
  'P0001', null, 'a non-admin actor is refused'
);
select throws_ok(
  format($$ select admin_reassign_order_rider(%L::uuid, null, 'support call', %L::uuid) $$, 'dd000000-0000-7000-8000-000000000009', tests.get_supabase_uid('dd_admin_susp')),
  '42501', null, 'a suspended admin is refused'
);
select throws_ok(
  format($$ select admin_reassign_order_rider(%L::uuid, null, '  ', %L::uuid) $$, 'dd000000-0000-7000-8000-000000000009', tests.get_supabase_uid('dd_admin')),
  '23514', 'admin_reassign_order_rider: a reason is required', 'a blank reason is refused'
);
select throws_ok(
  format($$ select admin_reassign_order_rider(%L::uuid, null, 'support call', %L::uuid) $$, 'dd000000-0000-7000-8000-0000000000ff', tests.get_supabase_uid('dd_admin')),
  'P0002', null, 'an unknown order is refused'
);

select throws_ok(
  format($$ select admin_reassign_order_rider(%L::uuid, null, 'support call', %L::uuid) $$, 'dd000000-0000-7000-8000-0000000000' || s.n, tests.get_supabase_uid('dd_admin')),
  '23514', null, format('order %s (%s) is refused', s.n, s.label)
)
from (values ('12', 'picked_up'), ('13', 'in_transit'), ('14', 'arrived'), ('15', 'delivered'), ('16', 'cancelled_by_platform'), ('17', 'placed')) as s(n, label);

select throws_ok(
  format($$ select admin_reassign_order_rider(%L::uuid, %L::uuid, 'support call', %L::uuid) $$, 'dd000000-0000-7000-8000-000000000012', tests.get_supabase_uid('dd_ra'), tests.get_supabase_uid('dd_admin')),
  '23514', null, 'assigning a rider onto a picked-up order is refused as well'
);

select is((select count(*)::int from admin_audit_log), 0, 'no refusal wrote an audit row');

-- ---------------------------------------------------------------------------
-- Re-offer from rider_assigned (order 01, rider ra)
-- ---------------------------------------------------------------------------

select is((select status::text from admin_reassign_order_rider('dd000000-0000-7000-8000-000000000001'::uuid, null, 'rider stopped answering', tests.get_supabase_uid('dd_admin'))), 'ready_for_pickup', 're-offer from rider_assigned returns the order to ready_for_pickup');
select is((select rider_id from orders where id = 'dd000000-0000-7000-8000-000000000001'::uuid), null, 'the rider is cleared');
select is((select rider_fee_kobo from orders where id = 'dd000000-0000-7000-8000-000000000001'::uuid), 0::bigint, 'the rider fee is cleared');
select is((select assigned_at from orders where id = 'dd000000-0000-7000-8000-000000000001'::uuid), null, 'assigned_at is cleared');
select is((select status from dispatch_offers where order_id = 'dd000000-0000-7000-8000-000000000001'::uuid and rider_id = tests.get_supabase_uid('dd_ra')), 'revoked', 'the removed rider''s offer is revoked');
select is((select count(*)::int from order_rider_locations where order_id = 'dd000000-0000-7000-8000-000000000001'::uuid), 0, 'the removed rider''s map position is deleted');
select is((select count(*)::int from rider_notifications where rider_id = tests.get_supabase_uid('dd_ra') and order_id = 'dd000000-0000-7000-8000-000000000001'::uuid), 1, 'the removed rider is notified');
select ok((select first_dispatched_at > now() - interval '1 minute' and dispatch_cycle_started_at > now() - interval '1 minute' from orders where id = 'dd000000-0000-7000-8000-000000000001'::uuid), 'the dispatch trigger restarted the rider clock and cycle');
select ok((select ready_at < now() - interval '1 hour' from orders where id = 'dd000000-0000-7000-8000-000000000001'::uuid), 'ready_at is left alone');
select is((select count(*)::int from dispatch_offers where order_id = 'dd000000-0000-7000-8000-000000000001'::uuid and status = 'offered' and rider_id in (tests.get_supabase_uid('dd_rj'), tests.get_supabase_uid('dd_rk'))), 2, 'other eligible riders were offered the order');
select is((select count(*)::int from dispatch_offers where order_id = 'dd000000-0000-7000-8000-000000000001'::uuid and rider_id in (tests.get_supabase_uid('dd_rb'), tests.get_supabase_uid('dd_rg'), tests.get_supabase_uid('dd_rf'))), 0, '... but not riders already on an order (rb, rg) or suspended (rf)');
select is((select count(*)::int from dispatch_offers where order_id = 'dd000000-0000-7000-8000-000000000001'::uuid and rider_id in (tests.get_supabase_uid('dd_rc'), tests.get_supabase_uid('dd_rd'), tests.get_supabase_uid('dd_re'), tests.get_supabase_uid('dd_rh'))), 0, 'ineligible riders (offline, stale, unapproved, unfundable) were not offered');
select is((select count(*)::int from admin_audit_log where target_id = 'dd000000-0000-7000-8000-000000000001'::uuid and action = 'order.reassign_rider' and reason = 'rider stopped answering'), 1, 'exactly one audit row');
select is(
  (select details - 'live_offers' from admin_audit_log where target_id = 'dd000000-0000-7000-8000-000000000001'::uuid),
  jsonb_build_object('mode', 'reoffer', 'previous_rider_id', tests.get_supabase_uid('dd_ra'), 'new_rider_id', null, 'from_status', 'rider_assigned', 'to_status', 'ready_for_pickup',
                     'rider_fee_kobo_before', 65000, 'rider_fee_kobo_after', 0),
  'the audit details record the swap and the fee before/after'
);
select is((select count(*)::int from order_events where order_id = 'dd000000-0000-7000-8000-000000000001'::uuid and actor_type = 'admin' and from_status = 'rider_assigned' and to_status = 'ready_for_pickup' and (meta->>'admin_reassign')::boolean), 1, 'exactly one admin order_events row');

select admin_reassign_order_rider('dd000000-0000-7000-8000-000000000001'::uuid, null, 'again', tests.get_supabase_uid('dd_admin'));
select is((select count(*)::int from admin_audit_log where target_id = 'dd000000-0000-7000-8000-000000000001'::uuid), 1, 're-offering an order already on offer is a no-op (no second audit row)');
select is((select count(*)::int from order_events where order_id = 'dd000000-0000-7000-8000-000000000001'::uuid and actor_type = 'admin'), 1, '... and no second event');

-- A nudge (order 03: ready, nobody on offer) - before the sweep below would do it first.
select is((select status::text from admin_reassign_order_rider('dd000000-0000-7000-8000-000000000003'::uuid, null, 'nobody was offered', tests.get_supabase_uid('dd_admin'))), 'ready_for_pickup', 'a nudge on a ready order with no offers keeps its status');
select ok(exists (select 1 from dispatch_offers where order_id = 'dd000000-0000-7000-8000-000000000003'::uuid and status = 'offered'), '... and creates offers');
select is((select first_dispatched_at < now() - interval '30 minutes' from orders where id = 'dd000000-0000-7000-8000-000000000003'::uuid), true, '... without touching first_dispatched_at');

reset role;
update dispatch_offers set status = 'expired' where order_id = 'dd000000-0000-7000-8000-000000000001'::uuid and status = 'offered';
-- ra is the nearest rider; a revoked one must not use up the single slot.
select is(_dispatch_offer_batch('dd000000-0000-7000-8000-000000000001'::uuid, now() + interval '1 hour', 1), 1, 'a revoked rider does not take up a slot in the batch');
update dispatch_offers set status = 'expired' where order_id = 'dd000000-0000-7000-8000-000000000001'::uuid and status = 'offered';
select tests.authenticate_as_service_role();
select sweep_dispatch_offers();
select is((select status from dispatch_offers where order_id = 'dd000000-0000-7000-8000-000000000001'::uuid and rider_id = tests.get_supabase_uid('dd_ra')), 'revoked', 'neither the batch nor the sweep ever re-offers the removed rider');

-- ---------------------------------------------------------------------------
-- Re-offer while preparing (order 02, early-accepted by rb)
-- ---------------------------------------------------------------------------

select is((select status::text from admin_reassign_order_rider('dd000000-0000-7000-8000-000000000002'::uuid, null, 'rider unreachable', tests.get_supabase_uid('dd_admin'))), 'preparing', 're-offer of an early-accepted order keeps its status');
select is((select rider_id from orders where id = 'dd000000-0000-7000-8000-000000000002'::uuid), null, '... clears the rider');
select is((select status from dispatch_offers where order_id = 'dd000000-0000-7000-8000-000000000002'::uuid and rider_id = tests.get_supabase_uid('dd_rb')), 'revoked', '... revokes their offer');
select ok(exists (select 1 from dispatch_offers where order_id = 'dd000000-0000-7000-8000-000000000002'::uuid and rider_id = tests.get_supabase_uid('dd_ra') and status = 'offered'), '... and offers the order right away to another rider');
select is((select count(*)::int from order_events where order_id = 'dd000000-0000-7000-8000-000000000002'::uuid and actor_type = 'admin' and from_status = 'preparing' and to_status = 'preparing'), 1, '... with a same-status admin event');

-- ---------------------------------------------------------------------------
-- Assign (orders 04 .. 08)
-- ---------------------------------------------------------------------------

select is((select status::text from admin_reassign_order_rider('dd000000-0000-7000-8000-000000000004'::uuid, tests.get_supabase_uid('dd_rj'), 'customer called ahead', tests.get_supabase_uid('dd_admin'))), 'rider_assigned', 'assigning onto a ready order makes it rider_assigned');
select is((select rider_id from orders where id = 'dd000000-0000-7000-8000-000000000004'::uuid), tests.get_supabase_uid('dd_rj'), '... with that rider');
select ok((select assigned_at > now() - interval '1 minute' from orders where id = 'dd000000-0000-7000-8000-000000000004'::uuid), '... assigned_at stamped');
select is((select status from dispatch_offers where order_id = 'dd000000-0000-7000-8000-000000000004'::uuid and rider_id = tests.get_supabase_uid('dd_rj')), 'accepted', 'their offer row is accepted');
select is((select count(*)::int from dispatch_offers where order_id = 'dd000000-0000-7000-8000-000000000004'::uuid and status = 'offered'), 0, 'every other live offer is expired');
select is((select status from dispatch_offers where order_id = 'dd000000-0000-7000-8000-000000000004'::uuid and rider_id = tests.get_supabase_uid('dd_rk')), 'expired', '... including the one that was live');
select is((select count(*)::int from rider_notifications where rider_id = tests.get_supabase_uid('dd_rj') and order_id = 'dd000000-0000-7000-8000-000000000004'::uuid), 1, 'the new rider is notified');
select is((select count(*)::int from order_events where order_id = 'dd000000-0000-7000-8000-000000000004'::uuid and actor_type = 'admin' and from_status = 'ready_for_pickup' and to_status = 'rider_assigned' and meta->>'new_rider_id' = tests.get_supabase_uid('dd_rj')::text), 1, 'one admin event ready_for_pickup -> rider_assigned');
select is((select details->>'mode' from admin_audit_log where target_id = 'dd000000-0000-7000-8000-000000000004'::uuid), 'assign', 'audited as an assign');
select admin_reassign_order_rider('dd000000-0000-7000-8000-000000000004'::uuid, tests.get_supabase_uid('dd_rj'), 'again', tests.get_supabase_uid('dd_admin'));
select is((select count(*)::int from admin_audit_log where target_id = 'dd000000-0000-7000-8000-000000000004'::uuid), 1, 'assigning the same rider twice is a no-op (no second audit row)');

-- The fee equals what the rider's own accept computes (rk sits where rj does: 549 m from the vendor).
select tests.authenticate_as('dd_rk');
select is((select status::text from accept_dispatch_offer('dd000000-0000-7000-8000-000000000005'::uuid)), 'rider_assigned', 'accept_dispatch_offer still assigns a ready order after the refactor');
select tests.clear_authentication();
select tests.authenticate_as_service_role();
select is((select rider_fee_kobo from orders where id = 'dd000000-0000-7000-8000-000000000004'::uuid), (select rider_fee_kobo from orders where id = 'dd000000-0000-7000-8000-000000000005'::uuid), 'the forced-assignment fee equals the accept fee');
select is((select rider_pickup_distance_m from orders where id = 'dd000000-0000-7000-8000-000000000004'::uuid), (select rider_pickup_distance_m from orders where id = 'dd000000-0000-7000-8000-000000000005'::uuid), '... and the pickup distance');
select is((select rider_fee_kobo from orders where id = 'dd000000-0000-7000-8000-000000000004'::uuid), 65000::bigint, '... which is the base plus one started kilometre');

select tests.authenticate_as('dd_rl');
select is((select status::text from accept_dispatch_offer('dd000000-0000-7000-8000-000000000006'::uuid)), 'preparing', 'accept_dispatch_offer still early-accepts a preparing order');
select tests.clear_authentication();
select tests.authenticate_as_service_role();
select is((select status::text from admin_reassign_order_rider('dd000000-0000-7000-8000-000000000007'::uuid, tests.get_supabase_uid('dd_rm'), 'vendor asked for rm', tests.get_supabase_uid('dd_admin'))), 'preparing', 'assigning onto a preparing order keeps the status (early-accept shape)');
select is((select rider_id from orders where id = 'dd000000-0000-7000-8000-000000000007'::uuid), tests.get_supabase_uid('dd_rm'), '... and claims the rider');
select is((select assigned_at from orders where id = 'dd000000-0000-7000-8000-000000000007'::uuid), null, '... without assigned_at');
select is((select rider_fee_kobo from orders where id = 'dd000000-0000-7000-8000-000000000007'::uuid), (select rider_fee_kobo from orders where id = 'dd000000-0000-7000-8000-000000000006'::uuid), 'the early assignment fee equals the early accept fee');
select is((select count(*)::int from order_events where order_id = 'dd000000-0000-7000-8000-000000000007'::uuid and actor_type = 'admin' and from_status = 'preparing' and to_status = 'preparing'), 1, '... with a same-status admin event');

select is((select rider_id from admin_reassign_order_rider('dd000000-0000-7000-8000-000000000008'::uuid, tests.get_supabase_uid('dd_ro'), 'rn broke down', tests.get_supabase_uid('dd_admin'))), tests.get_supabase_uid('dd_ro'), 'a swap on a rider_assigned order assigns the new rider');
select is((select status::text from orders where id = 'dd000000-0000-7000-8000-000000000008'::uuid), 'rider_assigned', '... and stays rider_assigned');
select ok((select assigned_at > now() - interval '1 minute' from orders where id = 'dd000000-0000-7000-8000-000000000008'::uuid), '... re-stamping assigned_at');
select is((select status from dispatch_offers where order_id = 'dd000000-0000-7000-8000-000000000008'::uuid and rider_id = tests.get_supabase_uid('dd_rn')), 'revoked', 'the swapped-out rider''s offer is revoked');
select is((select count(*)::int from order_rider_locations where order_id = 'dd000000-0000-7000-8000-000000000008'::uuid), 0, '... and their map position is deleted');
select is((select count(*)::int from rider_notifications where rider_id = tests.get_supabase_uid('dd_rn') and order_id = 'dd000000-0000-7000-8000-000000000008'::uuid), 1, '... and they are notified');

-- ---------------------------------------------------------------------------
-- Ineligible riders are refused (order 09); the picker agrees
-- ---------------------------------------------------------------------------

select throws_ok(format($$ select admin_reassign_order_rider(%L::uuid, %L::uuid, 'x1', %L::uuid) $$, 'dd000000-0000-7000-8000-000000000009', tests.get_supabase_uid('dd_rc'), tests.get_supabase_uid('dd_admin')), '23514', 'admin_reassign_order_rider: this rider is offline', 'an offline rider is refused');
select throws_ok(format($$ select admin_reassign_order_rider(%L::uuid, %L::uuid, 'x2', %L::uuid) $$, 'dd000000-0000-7000-8000-000000000009', tests.get_supabase_uid('dd_rd'), tests.get_supabase_uid('dd_admin')), '23514', 'admin_reassign_order_rider: this rider has not shared a location in the last 5 minutes', 'a stale ping is refused');
select throws_ok(format($$ select admin_reassign_order_rider(%L::uuid, %L::uuid, 'x3', %L::uuid) $$, 'dd000000-0000-7000-8000-000000000009', tests.get_supabase_uid('dd_re'), tests.get_supabase_uid('dd_admin')), '23514', 'admin_reassign_order_rider: this rider is not KYC-approved', 'an unapproved rider is refused');
select throws_ok(format($$ select admin_reassign_order_rider(%L::uuid, %L::uuid, 'x4', %L::uuid) $$, 'dd000000-0000-7000-8000-000000000009', tests.get_supabase_uid('dd_rf'), tests.get_supabase_uid('dd_admin')), '23514', 'admin_reassign_order_rider: this rider does not have an active account', 'a suspended rider is refused');
select throws_ok(format($$ select admin_reassign_order_rider(%L::uuid, %L::uuid, 'x5', %L::uuid) $$, 'dd000000-0000-7000-8000-000000000009', tests.get_supabase_uid('dd_rg'), tests.get_supabase_uid('dd_admin')), '23514', 'admin_reassign_order_rider: this rider already has an active order', 'a rider who already has an active order is refused');
select throws_ok(format($$ select admin_reassign_order_rider(%L::uuid, %L::uuid, 'x6', %L::uuid) $$, 'dd000000-0000-7000-8000-000000000009', tests.get_supabase_uid('dd_rj'), tests.get_supabase_uid('dd_admin')), '23514', 'admin_reassign_order_rider: this rider already has an active order', 'so is one assigned earlier in this file');
select throws_ok(format($$ select admin_reassign_order_rider(%L::uuid, %L::uuid, 'x7', %L::uuid) $$, 'dd000000-0000-7000-8000-000000000009', tests.get_supabase_uid('dd_rh'), tests.get_supabase_uid('dd_admin')), '23514', 'admin_reassign_order_rider: this order is too far from that rider - the payout would exceed what the order can fund', 'a rider whose fee the order cannot fund is refused');
select throws_ok(format($$ select admin_reassign_order_rider(%L::uuid, '00000000-0000-4000-8000-00000000dead'::uuid, 'x8', %L::uuid) $$, 'dd000000-0000-7000-8000-000000000009', tests.get_supabase_uid('dd_admin')), 'P0002', null, 'a rider that does not exist is refused');
select is((select count(*)::int from orders where id = 'dd000000-0000-7000-8000-000000000009'::uuid and rider_id is not null), 0, 'no refused assignment touched the order');

select is((select array_agg(rider_id order by pickup_distance_m, rider_id) filter (where rider_id in (tests.get_supabase_uid('dd_ra'), tests.get_supabase_uid('dd_rb'))) from admin_list_assignable_riders('dd000000-0000-7000-8000-000000000009'::uuid, 100)), array[tests.get_supabase_uid('dd_ra'), tests.get_supabase_uid('dd_rb')]::uuid[], 'the picker lists ra then rb, nearest first');
select is((select count(*)::int from admin_list_assignable_riders('dd000000-0000-7000-8000-000000000009'::uuid, 100) where rider_id in (tests.get_supabase_uid('dd_rc'), tests.get_supabase_uid('dd_rd'), tests.get_supabase_uid('dd_re'), tests.get_supabase_uid('dd_rf'), tests.get_supabase_uid('dd_rg'), tests.get_supabase_uid('dd_rh'), tests.get_supabase_uid('dd_rj'))), 0, '... and none of the ineligible riders');
select is((select rider_fee_kobo from admin_list_assignable_riders('dd000000-0000-7000-8000-000000000009'::uuid, 100) where rider_id = tests.get_supabase_uid('dd_rb')), 65000::bigint, '... quoting the exact fee');
select is((select count(*)::int from admin_list_assignable_riders('dd000000-0000-7000-8000-000000000009'::uuid, 1)), 1, '... honouring the limit');

-- ---------------------------------------------------------------------------
-- A rider far from the vendor still cannot accept; money is untouched
-- ---------------------------------------------------------------------------

select tests.authenticate_as('dd_rh');
select throws_ok(format($$ select accept_dispatch_offer(%L::uuid) $$, 'dd000000-0000-7000-8000-000000000011'), '23514', null, 'accept_dispatch_offer still refuses an unfundable rider');
select tests.clear_authentication();

-- rg already holds order 10, so an offer on 11 cannot become a second job.
reset role;
insert into dispatch_offers (order_id, rider_id, status) values ('dd000000-0000-7000-8000-000000000011'::uuid, tests.get_supabase_uid('dd_rg'), 'offered');
select tests.authenticate_as('dd_rg');
select throws_ok(format($$ select accept_dispatch_offer(%L::uuid) $$, 'dd000000-0000-7000-8000-000000000011'), '23514', 'accept_dispatch_offer: rider already has an active order', 'a rider already on an order cannot accept another');
select tests.clear_authentication();

select tests.authenticate_as_service_role();
select is((select count(*)::int from admin_audit_log where actor_id = tests.get_supabase_uid('dd_admin') and action = 'order.reassign_rider'), 6, 'six real changes, six audit rows');
select is((select count(*)::int from ledger_entries), (select ledger_entries from base_counts), 'no ledger entry was written by any of it');

select * from finish();
rollback;

-- CONCURRENCY. admin_reassign_order_rider() and accept_dispatch_offer() both
-- take `select ... from orders where id = ... for update` before reading the
-- rider/offer state, so they serialize. Two sessions, run by hand:
--   session 1: begin; select accept_dispatch_offer(<order>);      -- as the offered rider
--   session 2: select admin_reassign_order_rider(<order>, null, 'x', <admin>);   -- blocks
--   session 1: commit;   -- session 2 then sees rider_id set and unassigns that rider
-- and with the roles swapped the rider's accept fails "already assigned".
