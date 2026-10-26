-- pgTAP: admin_dispatch_metrics (0105) and the purge_dispatch_events caller check.
--
-- Known fixture (dated 30 days ahead so live local data cannot leak in; window = 2 hours before that):
--   offers  : o1 = declined(ring0) expired(ring1) accepted(ring1); o2 = expired(ring0) declined(ring2) cancelled(ring null);
--             o3 = accepted(ring0) superseded(ring1)  => 8 made, 2 accepted, 2 declined, 2 expired, 1 cancelled, 1 superseded,
--             rates .25/.25/.25, one offer beyond the rings, median ring 1.
--   assign  : o1 accepted->assigned 120 s, o3 240 s => median 180, p90 228; offers per order 3 and 2 => 2.5.
--   ready   : arrivals vs ready_at: o1 -60, o2 -180 (rider waited 60 / 180), o3 +300, o4 0 (food waited).

begin;
select no_plan();

select tests.create_supabase_user('dm_customer');
select tests.create_supabase_user('dm_vendor');
select tests.create_supabase_user('dm_r1');
select tests.create_supabase_user('dm_plain');

insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
values ('dd000000-0000-7000-8000-000000000501', 'DM Area',
        st_geogfromtext('POLYGON((7.0 9.0, 8.5 9.0, 8.5 10.0, 7.0 10.0, 7.0 9.0))'), true, 50000, 15000, 50000, 15000);
insert into vendors (id, owner_user_id, name, slug, status, location, commission_bps, delivery_radius_m, avg_prep_mins)
values ('dd000000-0000-7000-8000-000000000511', tests.get_supabase_uid('dm_vendor'), 'DM Bakery', 'dm-v1', 'active',
        st_geogfromtext('POINT(7.5 9.5)'), 1500, 20000, 20);
insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
values (tests.get_supabase_uid('dm_r1'), false, 'approved', st_geogfromtext('POINT(7.5045 9.5)'), now());

create function pg_temp.oid(p_n int) returns uuid language sql as $$ select ('dd000000-0000-7000-8000-00000000052' || p_n)::uuid $$;

insert into orders (id, customer_id, vendor_id, service_area_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo,
                    discount_kobo, total_kobo, delivery_address, delivery_location, rider_id, ready_at, accepted_at, delivery_by)
select pg_temp.oid(n), tests.get_supabase_uid('dm_customer'), 'dd000000-0000-7000-8000-000000000511',
       'dd000000-0000-7000-8000-000000000501', 'delivered', 'paid', 5000000, 50000, 100000, 0, 5150000,
       '{"line1": "1 Test Close"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'), tests.get_supabase_uid('dm_r1'),
       (now() + interval '30 days') - interval '1 hour', (now() + interval '30 days') - interval '10 minutes', 'rider'
from generate_series(1, 4) n;

insert into order_dispatch (order_id, state) select pg_temp.oid(n), 'stopped' from generate_series(1, 4) n
on conflict (order_id) do update set state = 'stopped';
update order_dispatch set assigned_at = (select accepted_at from orders where id = order_id) + interval '120 seconds'
  where order_id = pg_temp.oid(1);
update order_dispatch set assigned_at = (select accepted_at from orders where id = order_id) + interval '240 seconds'
  where order_id = pg_temp.oid(3);
update order_dispatch set rider_arrived_vendor_at = (select ready_at from orders where id = order_id) + v.d
  from (values (1, interval '-60 seconds'), (2, interval '-180 seconds'), (3, interval '300 seconds'), (4, interval '0')) v(n, d)
  where order_id = pg_temp.oid(v.n);
update order_dispatch set state = 'needs_attention' where order_id = pg_temp.oid(4);

insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, ring, offered_at, expires_at)
select pg_temp.oid(o), tests.get_supabase_uid('dm_r1'), s, 1, a, r, (now() + interval '30 days'), (now() + interval '30 days') + interval '1 hour'
from (values (1, 1, 'declined', 0), (1, 2, 'expired', 1), (1, 3, 'accepted', 1),
             (2, 1, 'expired', 0), (2, 2, 'declined', 2), (2, 3, 'cancelled', null),
             (3, 1, 'accepted', 0), (3, 2, 'superseded', 1)) t(o, a, s, r);

insert into dispatch_events (order_id, event, at)
select pg_temp.oid(o), e, (now() + interval '30 days')
from (values (1, 'ring_expanded'), (1, 'ring_expanded'), (2, 'ring_expanded'),
             (2, 'needs_attention'), (1, 'accept_conflict'), (1, 'accept_conflict'), (3, 'stale_accept_rejected'),
             (3, 'tick_lag'), (3, 'tick_error'), (3, 'tick_error'), (4, 'push_failed'), (4, 'offer_created')) t(o, e);

insert into dispatch_area_stats (service_area_id, speed_kmh, speed_source, speed_samples, secure_buffer_s, buffer_source, buffer_samples)
values ('dd000000-0000-7000-8000-000000000501', 21.5, 'history', 42, 150, 'default', 3)
on conflict (service_area_id) do update set speed_kmh = 21.5, speed_source = 'history', speed_samples = 42,
  secure_buffer_s = 150, buffer_source = 'default', buffer_samples = 3;

create temp table res (k text primary key, v jsonb);
grant all on res to public;

-- Grants
select ok(has_function_privilege('service_role', 'admin_dispatch_metrics(timestamptz)', 'execute')
      and not has_function_privilege('authenticated', 'admin_dispatch_metrics(timestamptz)', 'execute')
      and not has_function_privilege('anon', 'admin_dispatch_metrics(timestamptz)', 'execute'), 'metrics: service_role only');

-- Refusal for a non-service caller
select tests.authenticate_as('dm_plain');
select throws_ok($$ select admin_dispatch_metrics() $$, '42501', null, 'non-service caller refused (no execute grant)');
select throws_ok($$ select purge_dispatch_events() $$, '42501', null, 'purge refused for an authenticated caller');
select tests.clear_authentication();

-- Run as service role
select tests.authenticate_as_service_role();
insert into res select 'm', admin_dispatch_metrics(now() + interval '30 days' - interval '2 hours');
insert into res select 'empty', admin_dispatch_metrics(now() + interval '90 days');
insert into res select 'default', admin_dispatch_metrics();  -- 7 days: the future fixture is outside it
select ok(purge_dispatch_events() >= 0, 'purge works for service_role');
reset role;

-- Shape
select is((select array(select k from jsonb_object_keys(v) k order by k collate "C") from res where k = 'm'),
  array['areas', 'assignment', 'offers', 'readiness', 'reliability', 'search', 'since'], 'top-level keys');
select is((select array(select k from jsonb_object_keys(v -> 'offers') k order by k collate "C") from res where k = 'm'),
  array['accept_rate', 'accepted', 'cancelled', 'decline_rate', 'declined', 'expired', 'expiry_rate', 'made', 'superseded']
  , 'offers keys') ;
select is((select array(select k from jsonb_object_keys(v -> 'assignment') k order by k collate "C") from res where k = 'm'),
  array['median_offers_per_assigned_order', 'median_s', 'orders_assigned', 'p90_s'], 'assignment keys');
select is((select array(select k from jsonb_object_keys(v -> 'search') k order by k collate "C") from res where k = 'm'),
  array['beyond_rings_offers', 'median_ring', 'orders_with_expansion', 'ring_expansions'], 'search keys');
select is((select array(select k from jsonb_object_keys(v -> 'reliability') k order by k collate "C") from res where k = 'm'),
  array['accept_conflicts', 'needs_attention_events', 'needs_attention_now', 'push_failed', 'stale_accepts', 'tick_errors', 'tick_lag_events'],
  'reliability keys');
select ok((select (v -> 'readiness') ?& array['samples', 'rider_waited_share', 'food_waited_share', 'median_rider_wait_s',
  'p90_rider_wait_s', 'median_food_wait_s', 'p90_food_wait_s'] from res where k = 'm'), 'readiness keys');
select ok((select (v -> 'areas' -> 0) ?& array['service_area_id', 'name', 'speed_kmh', 'speed_source', 'speed_samples',
  'secure_buffer_s', 'buffer_source', 'buffer_samples', 'refreshed_at'] from res where k = 'm'), 'area keys');

-- Offers math
select is((select v -> 'offers' ->> 'made' from res where k = 'm'), '8', 'offers made');
select is((select (v -> 'offers' ->> 'accepted') || '/' || (v -> 'offers' ->> 'declined') || '/' || (v -> 'offers' ->> 'expired')
           || '/' || (v -> 'offers' ->> 'cancelled') || '/' || (v -> 'offers' ->> 'superseded') from res where k = 'm'),
  '2/2/2/1/1', 'offer outcomes');
select is((select (v -> 'offers' ->> 'accept_rate')::numeric from res where k = 'm'), 0.25, 'accept rate');
select is((select (v -> 'offers' ->> 'decline_rate')::numeric from res where k = 'm'), 0.25, 'decline rate');
select is((select (v -> 'offers' ->> 'expiry_rate')::numeric from res where k = 'm'), 0.25, 'expiry rate');

-- Assignment
select is((select (v -> 'assignment' ->> 'orders_assigned')::int from res where k = 'm'), 2, 'orders assigned');
select is((select (v -> 'assignment' ->> 'median_s')::numeric from res where k = 'm'), 180.0, 'median accept->assign');
select is((select (v -> 'assignment' ->> 'p90_s')::numeric from res where k = 'm'), 228.0, 'p90 accept->assign');
select is((select (v -> 'assignment' ->> 'median_offers_per_assigned_order')::numeric from res where k = 'm'), 2.5, 'median offers per assigned order');

-- Search
select is((select (v -> 'search' ->> 'ring_expansions')::int from res where k = 'm'), 3, 'ring expansions');
select is((select (v -> 'search' ->> 'orders_with_expansion')::int from res where k = 'm'), 2, 'orders with expansion');
select is((select (v -> 'search' ->> 'beyond_rings_offers')::int from res where k = 'm'), 1, 'beyond-ring offers');
select is((select (v -> 'search' ->> 'median_ring')::numeric from res where k = 'm'), 1.0, 'median ring');

-- Reliability
select is((select (v -> 'reliability' ->> 'needs_attention_now')::int from res where k = 'm'),
  (select count(*)::int from order_dispatch where state = 'needs_attention'), 'needs attention now = current rows');
select is((select (v -> 'reliability' ->> 'needs_attention_events')::int from res where k = 'm'), 1, 'attention events');
select is((select (v -> 'reliability' ->> 'accept_conflicts')::int from res where k = 'm'), 2, 'accept conflicts');
select is((select (v -> 'reliability' ->> 'stale_accepts')::int from res where k = 'm'), 1, 'stale accepts');
select is((select (v -> 'reliability' ->> 'tick_lag_events')::int from res where k = 'm'), 1, 'tick lag');
select is((select (v -> 'reliability' ->> 'tick_errors')::int from res where k = 'm'), 2, 'tick errors');
select is((select (v -> 'reliability' ->> 'push_failed')::int from res where k = 'm'), 1, 'push failed');

-- Readiness split
select is((select (v -> 'readiness' ->> 'samples')::int from res where k = 'm'), 4, 'readiness samples');
select is((select (v -> 'readiness' ->> 'rider_waited_share')::numeric from res where k = 'm'), 0.5, 'rider waited share');
select is((select (v -> 'readiness' ->> 'food_waited_share')::numeric from res where k = 'm'), 0.5, 'food waited share');
select is((select (v -> 'readiness' ->> 'median_rider_wait_s')::numeric from res where k = 'm'), 120.0, 'median rider wait');
select is((select (v -> 'readiness' ->> 'p90_rider_wait_s')::numeric from res where k = 'm'), 168.0, 'p90 rider wait');
select is((select (v -> 'readiness' ->> 'median_food_wait_s')::numeric from res where k = 'm'), 150.0, 'median food wait');
select is((select (v -> 'readiness' ->> 'p90_food_wait_s')::numeric from res where k = 'm'), 270.0, 'p90 food wait');

-- Areas
select is((select v -> 'areas' -> 0 ->> 'name' from res where k = 'm'), 'DM Area', 'area name');
select is((select (v -> 'areas' -> 0 ->> 'speed_kmh')::numeric from res where k = 'm'), 21.5, 'area speed');
select is((select (v -> 'areas' -> 0 ->> 'buffer_samples')::int from res where k = 'm'), 3, 'area buffer samples');

-- Empty window: zeros and nulls, never errors
select is((select v -> 'offers' ->> 'made' from res where k = 'empty'), '0', 'empty: no offers');
select ok((select (v -> 'offers' -> 'accept_rate') = 'null'::jsonb and (v -> 'offers' -> 'expiry_rate') = 'null'::jsonb from res where k = 'empty'),
  'empty: rates are null');
select ok((select (v -> 'assignment' -> 'median_s') = 'null'::jsonb and (v -> 'assignment' -> 'p90_s') = 'null'::jsonb
  and (v -> 'assignment' -> 'median_offers_per_assigned_order') = 'null'::jsonb from res where k = 'empty'), 'empty: assignment nulls');
select ok((select (v -> 'search' -> 'median_ring') = 'null'::jsonb from res where k = 'empty'), 'empty: median ring null');
select ok((select (v -> 'readiness' -> 'median_rider_wait_s') = 'null'::jsonb and (v -> 'readiness' -> 'p90_food_wait_s') = 'null'::jsonb
  and (v -> 'readiness' -> 'rider_waited_share') = 'null'::jsonb and (v -> 'readiness' ->> 'samples') = '0' from res where k = 'empty'),
  'empty: readiness nulls');
select is((select (v -> 'reliability' ->> 'tick_errors')::int from res where k = 'empty'), 0, 'empty: reliability zero');

-- Default window is 7 days back from now
select ok((select (v ->> 'since')::timestamptz between now() - interval '7 days 1 minute' and now() - interval '6 days 23 hours' from res where k = 'default'), 'default window is 7 days');

select * from finish();
rollback;
