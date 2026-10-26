-- pgTAP: admin-configurable dispatch (0097) and the vendor no-rider flow (0098).
--
-- What this protects:
-- (1) DEFAULTS KEEP TODAY'S BEHAVIOUR: no distance cap (live since 0066), 10
--     riders a round, 5-minute ping freshness. Changing a setting through
--     admin_set_dispatch_setting changes the very next round.
--     SEQUENTIAL DISPATCH (0100-0105, design C1/C3): a "round" is a cycle in which
--     riders are asked ONE AT A TIME (at most one live offer per order), nearest
--     eligible first; dispatch_max_riders is the number of riders asked per cycle
--     before the cycle restarts. Where this file used to assert "N riders were
--     offered at once" it now walks the order (the live offer lapses, the engine
--     asks the next rider) and asserts who is asked, in which order, and who never is.
--     A rider who holds a live offer on another order is not asked for a second one,
--     so every section parks the orders of the section before (pg_temp.park_all).
-- (2) WIDENING: with a first-round radius set, an order is offered only to
--     riders inside it; after dispatch_widen_after_seconds the search widens to
--     THE STORE'S OWN delivery radius (greatest(radius, store radius), capped at
--     50 km), never beyond, skipping declined riders and keeping the offer TTL.
-- (3) VISIBILITY: a stuck order shows up in admin_dispatch_status() with the
--     right reason; admin_redispatch_order works, refuses, audits.
-- (4) THE VENDOR IS TOLD (once) when no rider is near, can widen the search
--     (rate-limited, own orders only) - see vendor_self_delivery.sql for the
--     self-delivery half.
--
-- Geometry: V1 sits at POINT(7.5 9.5); one degree of longitude there is
-- ~109.8 km, so riders east of it at +0.0446 / +0.0465 / +0.0774 / +0.1093 /
-- +0.5465 degrees are ~4.9 / 5.1 / 8.5 / 12 / 60 km away. Twelve more riders sit
-- ~47 km away (POINT(7.8 9.8)). The big orders (subtotal 5,000,000) can fund any
-- rider fee, so the fee rule never interferes unless a test wants it to.

begin;
select no_plan();

create temp table res (k text primary key, v jsonb);
grant all on res to public;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('ds_admin');
select tests.create_supabase_user('ds_customer');
select tests.create_supabase_user('ds_v1');
select tests.create_supabase_user('ds_v8');
select tests.create_supabase_user('ds_v9');
select tests.create_supabase_user('ds_v6');
select tests.create_supabase_user('ds_ra');
select tests.create_supabase_user('ds_rb');
select tests.create_supabase_user('ds_rc');
select tests.create_supabase_user('ds_rd');
select tests.create_supabase_user('ds_rfar');
select tests.create_supabase_user('ds_cap' || i) from generate_series(1, 12) i;

insert into user_roles (user_id, role) values (tests.get_supabase_uid('ds_admin'), 'admin');

insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
values ('ee000000-0000-7000-8000-000000000201', 'DS Area',
        st_geogfromtext('POLYGON((7.0 9.0, 8.5 9.0, 8.5 10.0, 7.0 10.0, 7.0 9.0))'), true, 50000, 15000, 50000, 15000);

insert into vendors (id, owner_user_id, name, slug, status, location, commission_bps, delivery_radius_m) values
  ('ee000000-0000-7000-8000-000000000101', tests.get_supabase_uid('ds_v1'), 'DS V1 20km', 'ds-v1', 'active', st_geogfromtext('POINT(7.5 9.5)'), 1500, 20000),
  ('ee000000-0000-7000-8000-000000000103', tests.get_supabase_uid('ds_v1'), 'DS V3 10km', 'ds-v3', 'active', st_geogfromtext('POINT(7.5 9.5)'), 1500, 10000),
  ('ee000000-0000-7000-8000-000000000104', tests.get_supabase_uid('ds_v1'), 'DS V4 80km', 'ds-v4', 'active', st_geogfromtext('POINT(7.5 9.5)'), 1500, 80000),
  ('ee000000-0000-7000-8000-000000000105', tests.get_supabase_uid('ds_v1'), 'DS V5 nowhere', 'ds-v5', 'active', null, 1500, 3000),
  ('ee000000-0000-7000-8000-000000000106', tests.get_supabase_uid('ds_v6'), 'DS V6 remote 3km', 'ds-v6', 'active', st_geogfromtext('POINT(7.2 9.2)'), 1500, 3000),
  ('ee000000-0000-7000-8000-000000000107', tests.get_supabase_uid('ds_v1'), 'DS V7 small orders', 'ds-v7', 'active', st_geogfromtext('POINT(7.5 9.5)'), 1500, 20000),
  ('ee000000-0000-7000-8000-000000000108', tests.get_supabase_uid('ds_v8'), 'DS V8 20km, nobody near', 'ds-v8', 'active', st_geogfromtext('POINT(7.3 9.3)'), 1500, 20000),
  ('ee000000-0000-7000-8000-000000000109', tests.get_supabase_uid('ds_v9'), 'DS V9 20km', 'ds-v9', 'active', st_geogfromtext('POINT(7.44 9.5)'), 1500, 20000);

insert into vendor_staff (vendor_id, user_id, role) values
  ('ee000000-0000-7000-8000-000000000101', tests.get_supabase_uid('ds_v1'), 'vendor_owner'),
  ('ee000000-0000-7000-8000-000000000106', tests.get_supabase_uid('ds_v6'), 'vendor_owner'),
  ('ee000000-0000-7000-8000-000000000108', tests.get_supabase_uid('ds_v8'), 'vendor_owner'),
  ('ee000000-0000-7000-8000-000000000109', tests.get_supabase_uid('ds_v9'), 'vendor_owner')
on conflict do nothing;

insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
select tests.get_supabase_uid('ds_' || n), true, 'approved', st_geogfromtext(p), now()
from (values ('ra', 'POINT(7.5446 9.5)'), ('rb', 'POINT(7.5465 9.5)'), ('rd', 'POINT(7.5774 9.5)'),
             ('rc', 'POINT(7.6093 9.5)'), ('rfar', 'POINT(8.0465 9.5)')) as t(n, p);
insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
select tests.get_supabase_uid('ds_cap' || i), true, 'approved', st_geogfromtext('POINT(' || (7.8 + i * 0.001) || ' 9.8)'), now()
from generate_series(1, 12) i;

-- Orders: ready_for_pickup rows inserted directly (the dispatch trigger only
-- fires on a status UPDATE into ready_for_pickup). p_ready_ago = how long it
-- has been ready. Big orders can fund any rider; small ones cannot.
create function pg_temp.mk_order(p_n text, p_vendor text, p_ready_ago interval, p_status order_status default 'ready_for_pickup',
                                 p_small boolean default false, p_rider text default null)
returns void language sql as $$
  insert into orders (id, customer_id, vendor_id, service_area_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo,
                      discount_kobo, total_kobo, delivery_address, delivery_location, rider_id, ready_at, accepted_at, first_dispatched_at)
  values (('ee000000-0000-7000-8000-0000000003' || p_n)::uuid, tests.get_supabase_uid('ds_customer'),
          ('ee000000-0000-7000-8000-000000000' || p_vendor)::uuid, 'ee000000-0000-7000-8000-000000000201', p_status, 'paid',
          case when p_small then 100000 else 5000000 end, 50000, case when p_small then 10000 else 100000 end, 0,
          case when p_small then 160000 else 5150000 end,
          '{"line1": "1 DS Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'),
          case when p_rider is null then null else tests.get_supabase_uid(p_rider) end,
          case when p_status = 'ready_for_pickup' then now() - p_ready_ago end, now() - p_ready_ago, now() - p_ready_ago);
$$;

create function pg_temp.oid(p_n text) returns uuid language sql as $$ select ('ee000000-0000-7000-8000-0000000003' || p_n)::uuid $$;
-- Riders asked on an order, in the order they were asked (attempt_no), by fixture name: 'ra,rb,rd,...'.
create function pg_temp.asked(p_n text) returns text language sql as $$
  select coalesce(string_agg(coalesce((select n from unnest(array['ra', 'rb', 'rc', 'rd', 'rfar'] || array(select 'cap' || i from generate_series(1, 12) i)) n
                                       where tests.get_supabase_uid('ds_' || n) = d.rider_id), '?'), ',' order by d.attempt_no), '')
  from dispatch_offers d where d.order_id = pg_temp.oid(p_n) $$;
-- The rider holding the order's live offer ('' when none).
create function pg_temp.holder(p_n text) returns text language sql as $$
  select coalesce((select n from dispatch_offers d, unnest(array['ra', 'rb', 'rc', 'rd', 'rfar'] || array(select 'cap' || i from generate_series(1, 12) i)) n
                   where d.order_id = pg_temp.oid(p_n) and d.status = 'offered' and tests.get_supabase_uid('ds_' || n) = d.rider_id), '') $$;
-- The live offer times out (the tick closes it) and the engine asks the next rider: p_k asks in total.
create function pg_temp.walk(p_n text, p_k integer) returns void language plpgsql as $$
begin
  for i in 1..p_k loop
    update dispatch_offers set status = 'expired', close_reason = 'timeout' where order_id = pg_temp.oid(p_n) and status = 'offered';
    perform _dispatch_advance(pg_temp.oid(p_n), 'test');
  end loop;
end $$;
-- End of a section: drop every live offer and stop every dispatch row of this file's orders, so the riders are free
-- again and the global sweeps further down only see the orders under test.
create function pg_temp.park_all() returns void language sql as $$
  update dispatch_offers set status = 'cancelled', close_reason = 'test_park'
   where status = 'offered' and order_id::text like 'ee000000-%';
  update order_dispatch od set state = case when o.status = 'ready_for_pickup' then 'stopped' else od.state end,
                                next_check_at = case when o.status = 'ready_for_pickup' then null else now() + interval '1 day' end
    from orders o
   where o.id = od.order_id and od.state <> 'stopped' and od.order_id::text like 'ee000000-%';
$$;
create function pg_temp.has_offer(p_n text, p_rider text) returns boolean language sql as $$
  select exists (select 1 from dispatch_offers where order_id = pg_temp.oid(p_n) and rider_id = tests.get_supabase_uid(p_rider)) $$;
create function pg_temp.offer_count(p_n text) returns bigint language sql as $$
  select count(*) from dispatch_offers where order_id = pg_temp.oid(p_n) $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege(r.role, f.sig, 'execute'), format('%s cannot execute %s', r.role, f.sig))
from (values ('admin_set_dispatch_setting(text, integer, text, uuid)'), ('admin_dispatch_status()'),
             ('admin_redispatch_order(uuid, text, uuid, boolean)'), ('_dispatch_waiting_orders()')) as f(sig)
cross join (values ('anon'), ('authenticated')) as r(role);

select ok(has_function_privilege('service_role', f.sig, 'execute'), format('service_role can execute %s', f.sig))
from (values ('admin_set_dispatch_setting(text, integer, text, uuid)'), ('admin_dispatch_status()'),
             ('admin_redispatch_order(uuid, text, uuid, boolean)')) as f(sig);

select ok(not has_function_privilege(r.role, f.sig, 'execute'), format('%s cannot execute internal %s', r.role, f.sig))
from (values ('_dispatch_offer_round(uuid, timestamptz, integer, text)'), ('_dispatch_rider_counts(uuid, integer)'),
             ('_dispatch_store_radius_m(uuid)'), ('_redispatch_core(uuid, boolean)'), ('_complete_delivery(uuid, text, text, uuid)'),
             ('_vendor_order_guard(text, uuid, boolean)')) as f(sig)
cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role);

select ok(not has_function_privilege('anon', f.sig, 'execute') and has_function_privilege('authenticated', f.sig, 'execute'),
  format('%s is authenticated-only', f.sig))
from (values ('vendor_dispatch_state(uuid)'), ('vendor_expand_rider_search(uuid)'), ('vendor_start_self_delivery(uuid)'),
             ('vendor_advance_self_delivery(uuid, text)'), ('vendor_complete_self_delivery(uuid, text)')) as f(sig);

select ok(not has_table_privilege(r.role, 'dispatch_attempts', 'insert') and not has_table_privilege(r.role, 'dispatch_expansions', 'select'),
  format('%s has no write access to dispatch_attempts / read of dispatch_expansions', r.role))
from (values ('anon'), ('authenticated')) as r(role);

-- ---------------------------------------------------------------------------
-- Defaults preserve today's behaviour
-- ---------------------------------------------------------------------------

select is((select string_agg(key || '=' || value_int, ',' order by key) from platform_settings
           where key in ('dispatch_location_max_age_seconds', 'dispatch_max_riders', 'dispatch_notify_vendor_after_seconds', 'dispatch_radius_m', 'dispatch_widen_after_seconds')),
  'dispatch_location_max_age_seconds=300,dispatch_max_riders=10,dispatch_notify_vendor_after_seconds=45,dispatch_radius_m=0,dispatch_widen_after_seconds=60',
  'defaults: no radius cap (live since 0066), 10 riders, 60 s widen, 300 s ping window, 45 s vendor notice (the five original settings, unchanged)');
select is((select string_agg(key || '=' || value_int, ',' order by key) from platform_settings where key like 'dispatch_%'),
  'dispatch_default_speed_kmh=18,dispatch_default_travel_seconds=600,dispatch_h3_initial_ring=1,dispatch_h3_max_ring=8,dispatch_h3_resolution=8,dispatch_location_max_age_seconds=300,dispatch_max_riders=10,dispatch_min_history_samples=20,dispatch_notify_vendor_after_seconds=45,dispatch_offer_timeout_seconds=45,dispatch_radius_m=0,dispatch_road_factor_pct=135,dispatch_secure_buffer_seconds=150,dispatch_vendor_arrival_radius_m=100,dispatch_widen_after_seconds=60',
  'defaults: the full dispatch settings list (the five originals plus the sequential / H3 / timing keys of 0100); no global widened radius');

select pg_temp.mk_order('01', '101', interval '10 seconds');
select pg_temp.mk_order('02', '101', interval '10 seconds');
-- Sequential: ONE rider is asked at a time (old: the 10 nearest at once). The nearest, ra, gets the offer first.
select is(_dispatch_offer_batch(pg_temp.oid('01'), now()), 1, 'defaults: a round makes exactly ONE offer (sequential dispatch)');
select is(pg_temp.asked('01'), 'ra', 'defaults: it goes to the nearest eligible rider (4.9 km)');
select is((select count(*)::int from dispatch_offers where order_id = pg_temp.oid('01') and status = 'offered'), 1, 'defaults: exactly one live offer');
-- Walk the cycle: dispatch_max_riders = 10 riders are asked one at a time, nearest first, then the cycle restarts.
select pg_temp.walk('01', 9);
select is(pg_temp.asked('01'), 'ra,rb,rd,rc,cap1,cap2,cap3,cap4,cap5,cap6', 'defaults: the cycle asks the 10 nearest riders one at a time, nearest first');
select ok(pg_temp.has_offer('01', 'ds_rc'), 'defaults: with no radius cap the 12 km rider IS asked (the live behaviour the 5 km story assumed away)');
select ok(not pg_temp.has_offer('01', 'ds_rfar'), 'defaults: the 60 km rider is beyond the nearest 10');
select pg_temp.walk('01', 1);
select is((select cycle_no || '/' || rider_id::text from dispatch_offers where order_id = pg_temp.oid('01') and status = 'offered'),
  '2/' || tests.get_supabase_uid('ds_ra')::text, 'defaults: after 10 asks the cycle restarts (cycle 2) with the nearest rider again, who merely let the first offer lapse');
select pg_temp.park_all();

-- Changing max riders changes the next round.
select tests.authenticate_as_service_role();
select admin_set_dispatch_setting('dispatch_max_riders', 3, 'tighten for test', tests.get_supabase_uid('ds_admin'));
reset role;
select is(_dispatch_offer_batch(pg_temp.oid('02'), now()), 1, 'max riders 3 (changed via the RPC): the next round still makes one offer at a time');
select pg_temp.walk('02', 2);
select is(pg_temp.asked('02'), 'ra,rb,rd', 'the 3 nearest, nearest first');
select pg_temp.walk('02', 1);
select is(pg_temp.asked('02'), 'ra,rb,rd,ra', 'after 3 asks the cycle restarts: the 4th ask is the nearest again (cycle 2), never the 4th nearest');
select is((select cycle_no from dispatch_offers where order_id = pg_temp.oid('02') and status = 'offered'), 2, '... in cycle 2');
select pg_temp.park_all();
select tests.authenticate_as_service_role();
select admin_set_dispatch_setting('dispatch_max_riders', 10, 'restore', tests.get_supabase_uid('ds_admin'));
reset role;

-- ---------------------------------------------------------------------------
-- admin_set_dispatch_setting: validation, tier, audit
-- ---------------------------------------------------------------------------

select tests.authenticate_as('ds_admin');
select throws_ok(format($$ select admin_set_dispatch_setting('dispatch_radius_m', 5000, 'x', %L::uuid) $$, tests.get_supabase_uid('ds_admin')),
  '42501', null, 'an authenticated user (not the service-role key) cannot call the setter');
reset role;

select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_set_dispatch_setting('dispatch_radius_m', 5000, 'x', %L::uuid) $$, tests.get_supabase_uid('ds_customer')),
  'P0001', null, 'a non-admin actor is refused');
select throws_ok(format($$ select admin_set_dispatch_setting('dispatch_radius_m', 5000, '  ', %L::uuid) $$, tests.get_supabase_uid('ds_admin')),
  '23514', null, 'a blank reason is refused');
select throws_ok(format($$ select admin_set_dispatch_setting('dispatch_widened_radius_m', 20000, 'x', %L::uuid) $$, tests.get_supabase_uid('ds_admin')),
  '23514', null, 'the removed global widened radius is an unknown setting');
select throws_ok(format($$ select admin_set_dispatch_setting('nonsense', 1, 'x', %L::uuid) $$, tests.get_supabase_uid('ds_admin')),
  '23514', null, 'an unknown key is refused');
select throws_ok(format($$ select admin_set_dispatch_setting('dispatch_radius_m', %s, 'x', %L::uuid) $$, v, tests.get_supabase_uid('ds_admin')),
  '23514', null, format('radius %s is out of bounds (0 or 1000-50000)', v))
from unnest(array[500, 50001, -1]) v;
select throws_ok(format($$ select admin_set_dispatch_setting('dispatch_max_riders', %s, 'x', %L::uuid) $$, v, tests.get_supabase_uid('ds_admin')),
  '23514', null, format('max riders %s is out of bounds (1-50)', v))
from unnest(array[0, 51]) v;
select throws_ok(format($$ select admin_set_dispatch_setting('dispatch_widen_after_seconds', 1801, 'x', %L::uuid) $$, tests.get_supabase_uid('ds_admin')),
  '23514', null, 'widen delay above 1800 refused');
select throws_ok(format($$ select admin_set_dispatch_setting('dispatch_notify_vendor_after_seconds', 1801, 'x', %L::uuid) $$, tests.get_supabase_uid('ds_admin')),
  '23514', null, 'vendor notice delay above 1800 refused');
select throws_ok(format($$ select admin_set_dispatch_setting('dispatch_location_max_age_seconds', %s, 'x', %L::uuid) $$, v, tests.get_supabase_uid('ds_admin')),
  '23514', null, format('location freshness %s is out of bounds (60-300)', v))
from unnest(array[59, 301, 0]) v;
reset role;

select is((select count(*) from admin_audit_log where action = 'dispatch_setting.set'), 2::bigint, 'only the two real changes so far were audited (max 3, then back to 10)');

select tests.authenticate_as_service_role();
select admin_set_dispatch_setting('dispatch_radius_m', 5000, 'cap the first round at 5 km', tests.get_supabase_uid('ds_admin'));
select admin_set_dispatch_setting('dispatch_radius_m', 5000, 'same again', tests.get_supabase_uid('ds_admin'));
reset role;
select is((select count(*) from admin_audit_log where action = 'dispatch_setting.set' and details ->> 'key' = 'dispatch_radius_m'), 1::bigint,
  'an unchanged value is a no-op with no audit row');
select is((select details from admin_audit_log where action = 'dispatch_setting.set' and details ->> 'key' = 'dispatch_radius_m'),
  '{"key": "dispatch_radius_m", "unit": "m", "from": 0, "to": 5000}'::jsonb, 'the audit row carries before/after');
select is((select target_type from admin_audit_log where action = 'dispatch_setting.set' limit 1), 'platform_setting', 'audited against platform_setting');

-- ---------------------------------------------------------------------------
-- Radius, widening to the STORE radius, cap
-- ---------------------------------------------------------------------------

select pg_temp.mk_order('11', '101', interval '10 seconds');   -- 20 km store, fresh
select is((select o_offers from _dispatch_offer_round(pg_temp.oid('11'), now())), 1, 'radius 5 km: the first round makes exactly one offer');
select is(pg_temp.asked('11'), 'ra', 'radius 5 km: it goes to the only rider inside 5 km');
select ok(pg_temp.has_offer('11', 'ds_ra'), 'the rider at 4.9 km gets the offer');
select ok(not pg_temp.has_offer('11', 'ds_rb'), 'the rider at 5.1 km does not');
select is((select o_radius_m || '/' || o_tier from _dispatch_offer_round(pg_temp.oid('11'), now())), '5000/base',
  'before the wait the round is the base tier at 5000 m');

-- Wait elapsed: widen to the store's 20 km. ra declines; rc at 12 km now found.
update dispatch_offers set status = 'declined', responded_at = now() where order_id = pg_temp.oid('11') and rider_id = tests.get_supabase_uid('ds_ra');
update orders set ready_at = now() - interval '2 minutes' where id = pg_temp.oid('11');
select is((select o_offers || '/' || o_radius_m || '/' || o_tier from _dispatch_offer_round(pg_temp.oid('11'), now())), '1/20000/widened',
  'after 60 s the round widens to the 20 km store radius and asks the nearest untried rider in it (one offer)');
select is(pg_temp.holder('11'), 'rb', 'the nearest untried rider (5.1 km) holds the widened offer');
-- ... and the next ones after each lapse: 8.5 km, then 12 km. Then nobody is left in 20 km this cycle.
select pg_temp.walk('11', 2);
select is(pg_temp.asked('11'), 'ra,rb,rd,rc', 'the 5.1 / 8.5 / 12 km riders are asked one after another, nearest first');
select pg_temp.walk('11', 1);
select ok(not exists (select 1 from dispatch_offers d where d.order_id = pg_temp.oid('11') and d.rider_id in (tests.get_supabase_uid('ds_rfar'), tests.get_supabase_uid('ds_cap1'))),
  'riders beyond the store radius (47 km, 60 km) are never asked, even after the cycle restarted');
select is((select count(*)::int from dispatch_offers where order_id = pg_temp.oid('11') and rider_id = tests.get_supabase_uid('ds_ra')), 1, 'a declined rider is skipped, never asked again (not re-opened, no second row, even in the new cycle)');
select is((select status from dispatch_offers where order_id = pg_temp.oid('11') and rider_id = tests.get_supabase_uid('ds_ra')), 'declined', '... and stays declined');
select ok((select bool_and(expires_at - offered_at = _dispatch_offer_ttl()) from dispatch_offers where order_id = pg_temp.oid('11')),
  'widened offers carry the normal offer TTL');
select pg_temp.park_all();

-- A 10 km store never reaches the 12 km rider, however long it waits.
select pg_temp.mk_order('12', '103', interval '5 minutes');
select is((select o_offers || '/' || o_radius_m from _dispatch_offer_round(pg_temp.oid('12'), now())), '1/10000',
  '10 km store: widened radius is 10 km (greatest(5 km, 10 km)), one offer');
select pg_temp.walk('12', 3);   -- ra, rb, rd, then the cycle restarts
select ok(pg_temp.has_offer('12', 'ds_rd') and not pg_temp.has_offer('12', 'ds_rc'), 'the 8.5 km rider is asked, the 12 km rider never');
select is(pg_temp.asked('12'), 'ra,rb,rd,ra', '... exactly the three riders inside 10 km, then the cycle restarts with the nearest');
select pg_temp.park_all();

-- Safety cap: an 80 km store is capped at 50 km.
select tests.authenticate_as_service_role();
select admin_set_dispatch_setting('dispatch_max_riders', 50, 'for the cap test', tests.get_supabase_uid('ds_admin'));
reset role;
select pg_temp.mk_order('13', '104', interval '5 minutes');
select is((select o_radius_m from _dispatch_offer_round(pg_temp.oid('13'), now())), 50000, 'an 80 km store radius is capped at 50 km');
select pg_temp.walk('13', 15);   -- 16 asks in total, one rider at a time
select ok(not pg_temp.has_offer('13', 'ds_rfar') and pg_temp.has_offer('13', 'ds_cap12'), 'the 60 km rider is excluded by the cap, the 47 km riders are in');
select is(pg_temp.offer_count('13'), 16::bigint, 'exactly the 16 riders within 50 km are asked (one at a time)');
select is((select count(distinct rider_id)::int from dispatch_offers where order_id = pg_temp.oid('13')), 16, '... each of them once');
select pg_temp.park_all();
select is(_dispatch_store_radius_m('ee000000-0000-7000-8000-000000000104'), 50000, 'the store-radius helper applies the cap');
select tests.authenticate_as_service_role();
select admin_set_dispatch_setting('dispatch_max_riders', 10, 'restore', tests.get_supabase_uid('ds_admin'));
reset role;

-- Widening disabled (0): stays at the base radius forever.
select tests.authenticate_as_service_role();
select admin_set_dispatch_setting('dispatch_widen_after_seconds', 0, 'no auto widening', tests.get_supabase_uid('ds_admin'));
reset role;
select pg_temp.mk_order('14', '101', interval '1 hour');
select is((select o_offers || '/' || o_tier from _dispatch_offer_round(pg_temp.oid('14'), now())), '1/base', 'widen delay 0 = never widens automatically');
select pg_temp.walk('14', 1);
select is(pg_temp.asked('14'), 'ra,ra', 'widen delay 0: still only the 5 km rider is ever asked (the cycle just restarts with the nearest)');
select pg_temp.park_all();
select tests.authenticate_as_service_role();
select admin_set_dispatch_setting('dispatch_widen_after_seconds', 60, 'restore', tests.get_supabase_uid('ds_admin'));
reset role;

-- Ping freshness setting.
update riders set last_ping_at = now() - interval '200 seconds' where user_id = tests.get_supabase_uid('ds_rc');
select pg_temp.mk_order('15', '101', interval '5 minutes');
select pg_temp.mk_order('16', '101', interval '5 minutes');
select tests.authenticate_as_service_role();
select admin_set_dispatch_setting('dispatch_location_max_age_seconds', 120, 'stricter freshness', tests.get_supabase_uid('ds_admin'));
reset role;
select _dispatch_offer_round(pg_temp.oid('15'), now());
select pg_temp.walk('15', 3);   -- ra, rb, rd, rd's lapse restarts the cycle
select ok(not pg_temp.has_offer('15', 'ds_rc') and pg_temp.has_offer('15', 'ds_rd'), 'freshness 120 s: a rider whose last ping was 200 s ago is not asked, the fresh ones further out are');
select pg_temp.park_all();
select tests.authenticate_as_service_role();
select admin_set_dispatch_setting('dispatch_location_max_age_seconds', 300, 'default again', tests.get_supabase_uid('ds_admin'));
reset role;
select _dispatch_offer_round(pg_temp.oid('16'), now());
select pg_temp.walk('16', 3);   -- ra, rb, rd, rc
select ok(pg_temp.has_offer('16', 'ds_rc'), 'freshness 300 s (default): the same rider is asked');
select pg_temp.park_all();
update riders set last_ping_at = now() where user_id = tests.get_supabase_uid('ds_rc');

-- The sweep and early dispatch use the same logic.
select pg_temp.mk_order('17', '101', interval '5 minutes');
select tests.authenticate_as_service_role();
select * from sweep_dispatch_offers();
reset role;
select is((select radius_m from dispatch_offers where order_id = pg_temp.oid('17') and status = 'offered'), 20000,
  'sweep_dispatch_offers widens too: a 5-minute-old order at a 20 km store is offered at the widened 20 km radius (the 12 km rider is reachable, see order 11)');
select is(pg_temp.holder('17'), 'ra', '... one offer, to the nearest rider');
select pg_temp.mk_order('18', '101', interval '30 minutes', 'preparing');
-- The dispatch state row the accept trigger creates in production (this order is inserted past that point): the early dispatch
-- window opened 2 minutes ago, so the wait (counted from start_at since D8) is over the 60 s widen delay.
insert into order_dispatch (order_id, state, expected_ready_at, start_at, next_check_at)
values (pg_temp.oid('18'), 'scheduled', now() + interval '8 minutes', now() - interval '2 minutes', now() - interval '2 minutes');
select tests.authenticate_as_service_role();
select * from dispatch_orders_nearing_prep_completion();
reset role;
select is((select radius_m from dispatch_offers where order_id = pg_temp.oid('18') and status = 'offered'), 20000,
  'early dispatch widens too (wait counted from the end of the vendor prep lead): the early offer is at the widened 20 km radius');
select is(pg_temp.holder('18'), 'rb', '... one offer, to the nearest rider not already holding another live offer (ra holds order 17)');
select pg_temp.park_all();

-- 30 minute give-up still applies, widening or not (a vendor with no location can never be offered).
select pg_temp.mk_order('19', '105', interval '31 minutes');
update orders set first_dispatched_at = now() - interval '31 minutes' where id = pg_temp.oid('19');
select tests.authenticate_as_service_role();
select * from sweep_dispatch_offers();
reset role;
select is((select status::text from orders where id = pg_temp.oid('19')), 'cancelled_by_platform', 'the 30 minute give-up is unchanged');

-- ---------------------------------------------------------------------------
-- admin_dispatch_status
-- ---------------------------------------------------------------------------

select pg_temp.mk_order('21', '106', interval '5 minutes');                 -- remote vendor: nobody in range
select pg_temp.mk_order('22', '107', interval '5 minutes', 'ready_for_pickup', true);   -- small order: nobody fundable
select pg_temp.mk_order('23', '101', interval '5 minutes');                 -- offers made earlier, all expired
select pg_temp.mk_order('24', '101', interval '10 seconds');                -- too fresh to be listed
insert into dispatch_offers (order_id, rider_id, status, responded_at, cycle_no, attempt_no) values (pg_temp.oid('23'), tests.get_supabase_uid('ds_ra'), 'expired', now(), 1, 1);
select _dispatch_offer_round(pg_temp.oid('21'), now());
select pg_temp.mk_order('25', '101', interval '5 minutes');                 -- a live offer, waiting for the rider's reply
select _dispatch_offer_round(pg_temp.oid('25'), now());

create function pg_temp.reason(p_n text) returns text language sql as $$
  select e ->> 'reason' from jsonb_array_elements(admin_dispatch_status() -> 'stuck_orders') e where e ->> 'order_id' = pg_temp.oid(p_n)::text $$;

select tests.authenticate_as_service_role();
insert into res select 'status', admin_dispatch_status();
select is(pg_temp.reason('25'), 'waiting_for_rider_reply', 'status: a live offer -> waiting_for_rider_reply (was offers_pending)');
select is((select e -> 'live_offer' ->> 'rider_id' from res, jsonb_array_elements(v -> 'stuck_orders') e where e ->> 'order_id' = pg_temp.oid('25')::text), tests.get_supabase_uid('ds_ra')::text,
  'status: the live offer names the single rider asked (new live_offer block)');
select is(pg_temp.reason('21'), 'none_in_range', 'status: riders exist but none within the store radius -> none_in_range');
select is(pg_temp.reason('22'), 'fee_exceeds_order_budget', 'status: riders in range that the order cannot pay -> fee_exceeds_order_budget');
select is(pg_temp.reason('23'), 'all_declined_or_expired', 'status: offers made, none open -> all_declined_or_expired');
select is(pg_temp.reason('24'), null, 'status: an order waiting under 60 s is not listed');
select is(pg_temp.reason('19'), null, 'status: a cancelled order is not listed');
reset role;

select ok((select v -> 'settings' from res where k = 'status') @>
  '{"radius_m": 5000, "max_riders": 10, "widen_after_seconds": 60, "location_max_age_seconds": 300, "notify_vendor_after_seconds": 45}'::jsonb,
  'status: settings block still carries the five original settings');
select is((select v -> 'settings' from res where k = 'status'),
  '{"radius_m": 5000, "max_riders": 10, "h3_max_ring": 8, "h3_resolution": 8, "h3_initial_ring": 1, "road_factor_pct": 135, "default_speed_kmh": 18, "min_history_samples": 20, "widen_after_seconds": 60, "offer_timeout_seconds": 45, "secure_buffer_seconds": 150, "default_travel_seconds": 600, "vendor_arrival_radius_m": 100, "location_max_age_seconds": 300, "notify_vendor_after_seconds": 45}'::jsonb,
  'status: settings block, full (adds the sequential / H3 / timing settings)');
select is((select (v ->> 'online_riders')::int from res where k = 'status'), (select count(*)::int from riders where is_online and kyc_status = 'approved'), 'status: online approved riders');
select is((select e -> 'last_attempt' ->> 'riders_in_range' from res, jsonb_array_elements(v -> 'stuck_orders') e where e ->> 'order_id' = pg_temp.oid('21')::text), '0',
  'status: last_attempt records the zero-offer round (0 riders in range)');
select is((select e ->> 'store_radius_m' from res, jsonb_array_elements(v -> 'stuck_orders') e where e ->> 'order_id' = pg_temp.oid('25')::text), '20000', 'status: store_radius_m per order');
select ok((select e ->> 'nearest_online_rider_m' from res, jsonb_array_elements(v -> 'stuck_orders') e where e ->> 'order_id' = pg_temp.oid('21')::text)::int > 30000,
  'status: nearest online rider distance for the remote vendor (> 30 km)');
select is((select count(*) from dispatch_attempts where order_id = pg_temp.oid('21')), 1::bigint, 'one dispatch_attempts row per order and tier');
select _dispatch_offer_round(pg_temp.oid('21'), now());
select is((select attempts from dispatch_attempts where order_id = pg_temp.oid('21')), 1, 'a repeat round within a minute with the same numbers does not rewrite the row');

update riders set is_online = false;
select tests.authenticate_as_service_role();
select is(pg_temp.reason('23'), 'no_online_riders', 'status: nobody online -> no_online_riders');
reset role;
update riders set is_online = true;

select tests.authenticate_as_service_role();
select is((admin_dashboard_metrics() -> 'stuck_orders' ->> 'ready_without_rider')::int,
          jsonb_array_length(admin_dispatch_status() -> 'stuck_orders'),
          'dashboard ready_without_rider counts exactly the orders admin_dispatch_status lists');
select ok(admin_dashboard_metrics() -> 'stuck_orders' ? 'ready_without_rider_over_15m', 'the old 15-minute count survives as an additive field');
reset role;

-- ---------------------------------------------------------------------------
-- admin_redispatch_order
-- ---------------------------------------------------------------------------

select pg_temp.park_all();
select pg_temp.mk_order('31', '101', interval '10 seconds');
select pg_temp.mk_order('32', '101', interval '10 seconds');
select pg_temp.mk_order('33', '101', interval '10 seconds', 'preparing', false, 'ds_rb');
select pg_temp.mk_order('34', '101', interval '10 seconds', 'placed');

select tests.authenticate_as_service_role();
-- Sequential: a re-dispatch asks ONE rider (the nearest eligible). 32 goes first because only ra is inside its 5 km
-- base radius; ra then holds a live offer, so 31's widened search lands on the next rider.
insert into res select 'rd3', admin_redispatch_order(pg_temp.oid('32'), 'base radius only', tests.get_supabase_uid('ds_admin'), false);
insert into res select 'rd1', admin_redispatch_order(pg_temp.oid('31'), 'rider search stalled', tests.get_supabase_uid('ds_admin'));
insert into res select 'rd2', admin_redispatch_order(pg_temp.oid('31'), 'again', tests.get_supabase_uid('ds_admin'));
reset role;

select is((select v - 'offer_id' from res where k = 'rd1'),
  '{"tier": "widened", "radius_m": 20000, "outcome": "offered", "live_offer": false, "offers_created": 1, "riders_in_range": null}'::jsonb,
  'redispatch (widen) makes ONE offer within the 20 km store radius (old: 3 at once)');
select is((select (v ->> 'offer_id')::uuid from res where k = 'rd1'), (select id from dispatch_offers where order_id = pg_temp.oid('31') and status = 'offered'), '... and offer_id is the live offer on the order');
select is(pg_temp.holder('31'), 'rd', '... held by the nearest rider that is free (rb is busy on order 33, ra holds the offer on order 32)');
select is((select v ->> 'offers_created' from res where k = 'rd2'), '0', 'a second call creates no duplicates (the live offer is kept)');
select is((select v ->> 'live_offer' from res where k = 'rd2'), 'true', '... and says so (live_offer)');
select is((select v ->> 'radius_m' || '/' || (v ->> 'offers_created') from res where k = 'rd3'), '5000/1', 'widen = false stays at the base radius');
select is((select count(*) from admin_audit_log where action = 'order.redispatch'), 3::bigint, 'each call audited');
select is((select details ->> 'offers_created' from admin_audit_log where action = 'order.redispatch' and target_id = pg_temp.oid('32')), '1', 'audit carries the result');

select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_redispatch_order(%L::uuid, 'x', %L::uuid) $$, pg_temp.oid('33'), tests.get_supabase_uid('ds_admin')), '23514', null, 'refused: the order already has a rider');
select throws_ok(format($$ select admin_redispatch_order(%L::uuid, 'x', %L::uuid) $$, pg_temp.oid('34'), tests.get_supabase_uid('ds_admin')), '23514', null, 'refused: status placed is not dispatchable');
select throws_ok(format($$ select admin_redispatch_order(%L::uuid, ' ', %L::uuid) $$, pg_temp.oid('31'), tests.get_supabase_uid('ds_admin')), '23514', null, 'refused: reason required');
select throws_ok(format($$ select admin_redispatch_order(%L::uuid, 'x', %L::uuid) $$, pg_temp.oid('31'), tests.get_supabase_uid('ds_customer')), 'P0001', null, 'refused: non-admin actor');
select throws_ok(format($$ select admin_redispatch_order(%L::uuid, 'x', %L::uuid) $$, 'ee000000-0000-7000-8000-000000009999', tests.get_supabase_uid('ds_admin')), 'P0002', null, 'refused: unknown order');
reset role;
select is((select count(*) from admin_audit_log where action = 'order.redispatch'), 3::bigint, 'no refusal wrote an audit row');

select pg_temp.park_all();
select pg_temp.mk_order('35', '101', interval '5 minutes');
select _dispatch_offer_round(pg_temp.oid('35'), now());
update dispatch_offers set status = 'declined', close_reason = 'declined' where order_id = pg_temp.oid('35') and rider_id = tests.get_supabase_uid('ds_ra');
select tests.authenticate_as_service_role();
select admin_redispatch_order(pg_temp.oid('35'), 'declined riders stay declined', tests.get_supabase_uid('ds_admin'));
reset role;
select is((select status from dispatch_offers where order_id = pg_temp.oid('35') and rider_id = tests.get_supabase_uid('ds_ra')), 'declined', 'redispatch never resets a declined rider');
select is((select count(*)::int from dispatch_offers where order_id = pg_temp.oid('35') and rider_id = tests.get_supabase_uid('ds_ra')), 1, '... nor asks them again (no second row)');
select ok(pg_temp.holder('35') not in ('', 'ra'), '... the re-dispatch asked a different rider instead');

-- ---------------------------------------------------------------------------
-- Vendor notification: once, only when nobody is near and nothing is pending
-- ---------------------------------------------------------------------------

select pg_temp.park_all();
select pg_temp.mk_order('41', '109', interval '50 seconds');   -- V9: nobody within 5 km, 4 riders within its 20 km
select pg_temp.mk_order('42', '109', interval '50 seconds');   -- a live offer exists
select pg_temp.mk_order('43', '109', interval '5 seconds');    -- too soon
select pg_temp.mk_order('44', '101', interval '50 seconds');   -- a rider is in range
insert into dispatch_offers (order_id, rider_id, cycle_no, attempt_no) values (pg_temp.oid('42'), tests.get_supabase_uid('ds_rc'), 1, 1);

select _dispatch_offer_round(pg_temp.oid('41'), now());
select _dispatch_offer_round(pg_temp.oid('41'), now());
select _dispatch_offer_round(pg_temp.oid('42'), now());
select _dispatch_offer_round(pg_temp.oid('43'), now());
select _dispatch_offer_round(pg_temp.oid('44'), now());
select _dispatch_offer_round(pg_temp.oid('44'), now());

select is((select count(*) from notifications where order_id = pg_temp.oid('41') and kind = 'no_rider_nearby'), 1::bigint, 'notice fires once, however many rounds run');
select is((select body from notifications where order_id = pg_temp.oid('41') and kind = 'no_rider_nearby'),
  format('No rider is near you right now for order %s. You can look for riders up to 20 km away, or deliver it yourself.', (select code from orders where id = pg_temp.oid('41'))),
  'notice text names the store radius');
select is((select vendor_id from notifications where order_id = pg_temp.oid('41') and kind = 'no_rider_nearby'), 'ee000000-0000-7000-8000-000000000109'::uuid, 'addressed to the vendor, not the customer');
select is((select customer_id from notifications where order_id = pg_temp.oid('41') and kind = 'no_rider_nearby'), null, 'no customer audience');
select is((select count(*) from notifications where order_id = pg_temp.oid('42') and kind = 'no_rider_nearby'), 0::bigint, 'no notice while an offer is pending');
select is((select count(*) from notifications where order_id = pg_temp.oid('43') and kind = 'no_rider_nearby'), 0::bigint, 'no notice before the delay');
select is((select count(*) from notifications where order_id = pg_temp.oid('44') and kind = 'no_rider_nearby'), 0::bigint, 'no notice when a rider is in range');

select tests.authenticate_as('ds_v9');
select is((select count(*) from notifications where kind = 'no_rider_nearby'), 1::bigint, 'the vendor staff can read their notice (existing vendor realtime/RLS path)');
select tests.authenticate_as('ds_v8');
select is((select count(*) from notifications where kind = 'no_rider_nearby'), 0::bigint, 'another vendor cannot');
reset role;

select pg_temp.mk_order('45', '109', interval '50 seconds');
select tests.authenticate_as_service_role();
select admin_set_dispatch_setting('dispatch_notify_vendor_after_seconds', 0, 'notices off', tests.get_supabase_uid('ds_admin'));
reset role;
select _dispatch_offer_round(pg_temp.oid('45'), now());
select is((select count(*) from notifications where order_id = pg_temp.oid('45') and kind = 'no_rider_nearby'), 0::bigint, 'notice delay 0 = off');
select tests.authenticate_as_service_role();
select admin_set_dispatch_setting('dispatch_notify_vendor_after_seconds', 45, 'back on', tests.get_supabase_uid('ds_admin'));
reset role;

-- ---------------------------------------------------------------------------
-- vendor_dispatch_state / vendor_expand_rider_search
-- ---------------------------------------------------------------------------

-- Orders 42 and 44 hold live offers (rc, ra) from the notice tests; release those riders for the expand tests below
-- (order 41 itself is left exactly as the engine left it).
update dispatch_offers set status = 'cancelled', close_reason = 'test_park'
 where order_id in (pg_temp.oid('42'), pg_temp.oid('44')) and status = 'offered';
select tests.authenticate_as('ds_v9');
insert into res select 'vs1', vendor_dispatch_state(pg_temp.oid('41'));
reset role;
select ok((select v from res where k = 'vs1') @>
  '{"state": "no_rider_nearby", "can_expand": true, "expand_available_in_seconds": null, "riders_in_range": 0, "radius_m": 5000, "base_radius_m": 5000, "store_radius_m": 20000, "expansions_used": 0}'::jsonb,
  'vendor_dispatch_state: no rider nearby, can expand, store radius 20 km (all the original keys unchanged)');
select is((select (v ->> 'dispatch_state') || '/' || (v ->> 'attempts_made') from res where k = 'vs1'), 'needs_attention/0',
  'vendor_dispatch_state: the new dispatch_state / attempts_made (nobody was ever asked, waited past the notice delay)');
select ok((select v ? 'expected_ready_at' and v ? 'start_at' and v ? 'searching_since' and v ? 'assigned_eta_at' and (v -> 'assigned_eta_at') = 'null'::jsonb from res where k = 'vs1'),
  'vendor_dispatch_state: carries expected_ready_at, start_at, searching_since and a null assigned_eta_at');

select tests.authenticate_as('ds_v8');
select throws_ok(format($$ select vendor_dispatch_state(%L::uuid) $$, pg_temp.oid('41')), '42501', null, 'another vendor cannot read the state');
select throws_ok(format($$ select vendor_expand_rider_search(%L::uuid) $$, pg_temp.oid('41')), '42501', null, 'another vendor cannot expand the search');
reset role;
select is((select count(*) from dispatch_expansions), 0::bigint, 'a refused expand recorded nothing');

select tests.authenticate_as('ds_v9');
insert into res select 'ex1', vendor_expand_rider_search(pg_temp.oid('41'));
reset role;
select is((select v - 'offer_id' from res where k = 'ex1'),
  '{"tier": "widened", "radius_m": 20000, "outcome": "offered", "live_offer": false, "offers_created": 1, "riders_in_range": null}'::jsonb,
  'expand: asks ONE rider within the store radius (old: 3 at once; rb is busy on order 33); the vendor supplies no distance');
select is((select (v ->> 'offer_id')::uuid from res where k = 'ex1'), (select id from dispatch_offers where order_id = pg_temp.oid('41') and status = 'offered'), '... and offer_id is the live offer on the order');

select tests.authenticate_as('ds_v9');
select throws_ok(format($$ select vendor_expand_rider_search(%L::uuid) $$, pg_temp.oid('41')), 'P0429', null, 'expand again straight away is rate limited');
reset role;
update dispatch_expansions set expanded_at = now() - interval '3 minutes';
select tests.authenticate_as('ds_v9');
insert into res select 'ex2', vendor_expand_rider_search(pg_temp.oid('41'));
reset role;
select is((select v ->> 'offers_created' from res where k = 'ex2'), '0', 'a second expand after the pause creates no duplicate offers');
update dispatch_expansions set expanded_at = now() - interval '3 minutes';
select tests.authenticate_as('ds_v9');
select lives_ok(format($$ select vendor_expand_rider_search(%L::uuid) $$, pg_temp.oid('41')), 'third expand allowed');
reset role;
update dispatch_expansions set expanded_at = now() - interval '3 minutes';
select tests.authenticate_as('ds_v9');
select throws_like(format($$ select vendor_expand_rider_search(%L::uuid) $$, pg_temp.oid('41')), '%widened 3 times%', 'fourth expand refused: max 3 per order');
reset role;

-- Nothing wider to search: 3 km store radius under a 5 km base.
select pg_temp.mk_order('46', '106', interval '50 seconds');
select tests.authenticate_as('ds_v6');
select throws_like(format($$ select vendor_expand_rider_search(%L::uuid) $$, pg_temp.oid('46')), '%full delivery radius%', 'refused when the store radius is no wider than the one in use');
select is((vendor_dispatch_state(pg_temp.oid('46')) ->> 'can_expand')::boolean, false, 'state: can_expand false when nothing is wider');
reset role;

-- Suspended vendor account.
update profiles set status = 'suspended' where id = tests.get_supabase_uid('ds_v9');
select pg_temp.mk_order('47', '109', interval '50 seconds');
select tests.authenticate_as('ds_v9');
select throws_ok(format($$ select vendor_expand_rider_search(%L::uuid) $$, pg_temp.oid('47')), '42501', null, 'a suspended vendor account cannot expand');
reset role;
update profiles set status = 'active' where id = tests.get_supabase_uid('ds_v9');

select * from finish();
rollback;
