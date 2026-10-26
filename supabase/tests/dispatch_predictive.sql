-- pgTAP: predictive dispatch timing (0104, design D7/D8): calibrated ETA, start_at with its
-- basis, the vendor prep estimate, ready early / overrun, rider ETA and arrival bookkeeping.
--
-- Geometry: the vendor sits at POINT(7.5 9.5). Riders sit east of it on the same latitude, so
-- distance and ETA are deterministic (default 18 km/h, road factor 135%, +60 s):
--   dx 0.0045 -> 494 m -> ETA 193 s     dx 0.0090 -> 988 m  -> ETA 327 s
--   dx 0.0142 -> 1559 m -> ETA 481 s    dx 0.0600 -> 6588 m -> ETA 1839 s
--   dx 0.1200 -> 13176 m -> ETA 3618 s
-- Defaults: secure buffer 150 s, default travel 600 s, 45 s offers, min history samples 20.
--
-- Scenarios (the owner's): (a) 20 min prep, rider needs ~8 min; (b) 10 min prep, first rider
-- declines; (c) riders do not answer: buffer learns from history; (d) prep delayed after accept;
-- (e) ready early; (f) rider ETA grows after assignment; (g) nobody can arrive in time.

begin;
select no_plan();

select tests.create_supabase_user('pt_customer');
select tests.create_supabase_user('pt_vendor');
select tests.create_supabase_user('pt_other');
select tests.create_supabase_user('pt_' || n) from unnest(array['ra', 'rb', 'rc', 'rd', 're', 'rf', 'rg', 'rfar', 'ro', 'rbusy']) n;

insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
values ('ee000000-0000-7000-8000-000000000701', 'PT Area',
        st_geogfromtext('POLYGON((7.0 9.0, 8.5 9.0, 8.5 10.0, 7.0 10.0, 7.0 9.0))'), true, 50000, 15000, 50000, 15000);
insert into vendors (id, owner_user_id, name, slug, status, location, commission_bps, delivery_radius_m, avg_prep_mins) values
  ('ee000000-0000-7000-8000-000000000711', tests.get_supabase_uid('pt_vendor'), 'PT V1 (20 min)', 'pt-v1', 'active', st_geogfromtext('POINT(7.5 9.5)'), 1500, 20000, 20),
  ('ee000000-0000-7000-8000-000000000712', tests.get_supabase_uid('pt_vendor'), 'PT V2 (10 min)', 'pt-v2', 'active', st_geogfromtext('POINT(7.5 9.5)'), 1500, 20000, 10),
  ('ee000000-0000-7000-8000-000000000713', tests.get_supabase_uid('pt_vendor'), 'PT V3 (5 min)', 'pt-v3', 'active', st_geogfromtext('POINT(7.5 9.5)'), 1500, 20000, 5);
insert into vendor_staff (vendor_id, user_id, role)
select id, tests.get_supabase_uid('pt_vendor'), 'vendor_owner' from vendors where slug like 'pt-v%' on conflict do nothing;

insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
select tests.get_supabase_uid('pt_' || n), true, 'approved', st_geogfromtext('POINT(' || (7.5 + dx) || ' 9.5)'), now()
from (values ('ra', 0.0142), ('rb', 0.0045), ('rc', 0.009), ('rd', 0.0045), ('re', 0.0045), ('rf', 0.0045),
             ('rg', 0.0045), ('rfar', 0.12), ('ro', 0.0045), ('rbusy', 0.0045)) t(n, dx);

create function pg_temp.uid(p text) returns uuid language sql as $$ select tests.get_supabase_uid('pt_' || p) $$;
create function pg_temp.oid(p_n text) returns uuid language sql as $$ select ('ee000000-0000-7000-8000-0000000007' || p_n)::uuid $$;
create function pg_temp.mk_order(p_n text, p_status order_status default 'placed', p_vendor text default '711',
                                 p_accepted_ago interval default '0', p_rider text default null, p_delivery_by text default 'rider')
returns void language sql as $$
  insert into orders (id, customer_id, vendor_id, service_area_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo,
                      discount_kobo, total_kobo, delivery_address, delivery_location, rider_id, accepted_at, delivery_by)
  values (pg_temp.oid(p_n), tests.get_supabase_uid('pt_customer'), ('ee000000-0000-7000-8000-000000000' || p_vendor)::uuid,
          'ee000000-0000-7000-8000-000000000701', p_status, 'paid', 5000000, 50000, 100000, 0, 5150000,
          '{"line1": "1 PT Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'),
          case when p_rider is null then null else pg_temp.uid(p_rider) end,
          case when p_status in ('placed', 'draft') then null else now() - p_accepted_ago end, p_delivery_by);
$$;
-- A vendor accept the way production does it: the status UPDATE fires the trigger.
create function pg_temp.accept(p_n text, p_vendor text default '711') returns void language sql as $$
  select pg_temp.mk_order(p_n, 'placed', p_vendor);
  update orders set status = 'accepted', accepted_at = now() where id = pg_temp.oid(p_n);
$$;
create function pg_temp.only(variadic p_names text[]) returns void language sql as $$
  delete from dispatch_offers where order_id in (select id from orders where service_area_id = 'ee000000-0000-7000-8000-000000000701' and status in ('placed', 'accepted', 'preparing', 'ready_for_pickup'));
  update riders set is_online = exists (select 1 from unnest(p_names) n where pg_temp.uid(n) = riders.user_id), last_ping_at = now();
$$;
create function pg_temp.at(p_n text) returns order_dispatch language sql as $$ select * from order_dispatch where order_id = pg_temp.oid(p_n) $$;
create function pg_temp.ev(p_n text, p_event text) returns bigint language sql as $$
  select count(*) from dispatch_events where order_id = pg_temp.oid(p_n) and event = p_event $$;
create function pg_temp.live_rider(p_n text) returns uuid language sql as $$
  select rider_id from dispatch_offers where order_id = pg_temp.oid(p_n) and status = 'offered' $$;
create function pg_temp.move(p_r text, p_dx numeric) returns void language sql as $$
  update riders set current_location = st_geogfromtext('POINT(' || (7.5 + p_dx) || ' 9.5)') where user_id = pg_temp.uid(p_r) $$;
-- Run one statement as a signed-in user; returns the single text result or 'ERR:<sqlstate>'.
create function pg_temp.as_user(p_user text, p_sql text) returns text language plpgsql as $$
declare v text := 'ok';
begin
  perform tests.authenticate_as(p_user);
  begin execute p_sql into v; exception when others then v := 'ERR:' || sqlstate; end;
  reset role;
  return v;
end $$;
-- Make the throttle windows pass without waiting.
create function pg_temp.age_basis(p_n text) returns void language sql as $$
  update order_dispatch set start_basis = jsonb_set(start_basis, '{computed_at}', to_jsonb(now() - interval '2 minutes')) where order_id = pg_temp.oid(p_n) $$;
create function pg_temp.tick(p_n text) returns jsonb language sql as $$ select _dispatch_tick_order(pg_temp.oid(p_n), 'test', null) $$;

-- ---------------------------------------------------------------------------
-- Grants and the cache table
-- ---------------------------------------------------------------------------

select ok(has_function_privilege('authenticated', 'vendor_update_prep_estimate(uuid, integer)', 'execute')
          and not has_function_privilege('anon', 'vendor_update_prep_estimate(uuid, integer)', 'execute'),
  'vendor_update_prep_estimate: authenticated yes, anon no');
select ok(not has_function_privilege(r.role, f.sig, 'execute'), format('%s cannot execute internal %s', r.role, f.sig))
from (values ('_dispatch_area_stats_refresh(uuid, boolean)'), ('_dispatch_start_calc(orders, timestamptz)'), ('_dispatch_recompute_start(uuid, boolean)'),
             ('_dispatch_tick_timing(uuid)'), ('_dispatch_rider_ping(uuid, double precision, double precision)'), ('_dispatch_ready_early(orders)'))
  as f(sig) cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role);
select ok((select relrowsecurity from pg_class where oid = 'dispatch_area_stats'::regclass), 'dispatch_area_stats: RLS on');
select ok(has_table_privilege('service_role', 'dispatch_area_stats', 'select') and not has_table_privilege('authenticated', 'dispatch_area_stats', 'select')
          and not has_table_privilege('anon', 'dispatch_area_stats', 'select') and not has_table_privilege('service_role', 'dispatch_area_stats', 'insert'),
  'dispatch_area_stats: service_role select only');

-- ---------------------------------------------------------------------------
-- (a) 20 min prep, the rider needs 8 min
-- ---------------------------------------------------------------------------

select is(_estimate_travel_seconds(st_geogfromtext('POINT(7.5142 9.5)'), st_geogfromtext('POINT(7.5 9.5)'), null), 481, 'geometry: ra is 481 s from the vendor');
select pg_temp.only('ra');
select pg_temp.accept('01');
select is((pg_temp.at('01')).start_at, now() + interval '569 seconds', '(a) start_at = accepted + 1200 - 481 (rider ETA) - 150 (buffer) = +569 s');
select is((pg_temp.at('01')).start_basis - 'computed_at',
  jsonb_build_object('travel_s', 481, 'travel_source', 'candidates', 'buffer_s', 150, 'buffer_source', 'default', 'candidates_used', 1,
                     'expected_ready_at', now() + interval '20 minutes'),
  '(a) the basis records travel, buffer, sources, candidates and expected ready');
select is((pg_temp.at('01')).next_check_at, now() + interval '60 seconds', '(a) next look in 60 s (recompute cadence), not at start_at');
select is(_dispatch_advance(pg_temp.oid('01'), 'test') ->> 'reason', 'not_due', '(a) before start_at the engine does not dispatch');
select is((select count(*) from dispatch_offers where order_id = pg_temp.oid('01')), 0::bigint, '(a) no offer exists before start_at');
update order_dispatch set start_at = now() - interval '1 second', next_check_at = now() where order_id = pg_temp.oid('01');
select is(_dispatch_advance(pg_temp.oid('01'), 'test') ->> 'outcome', 'offered', '(a) once start_at passes the order is offered');
select is(pg_temp.live_rider('01'), pg_temp.uid('ra'), '(a) ... to the only eligible rider');

-- a ready order starts immediately whatever start_at says (0101 behaviour)
select pg_temp.only('rb');
select pg_temp.mk_order('02', 'ready_for_pickup');
update orders set ready_at = now() where id = pg_temp.oid('02');
insert into order_dispatch (order_id, state, start_at, next_check_at) values (pg_temp.oid('02'), 'scheduled', now() + interval '1 hour', now() + interval '1 hour');
select is(_dispatch_advance(pg_temp.oid('02'), 'test') ->> 'outcome', 'offered', 'ready_for_pickup starts dispatch at once, start_at an hour away');

-- ---------------------------------------------------------------------------
-- (b) 10 min prep, the first rider declines: the next one is asked immediately
-- ---------------------------------------------------------------------------

select pg_temp.only('rb', 'rc');
select pg_temp.mk_order('03', 'accepted', '712', interval '9 minutes');
select is(_dispatch_advance(pg_temp.oid('03'), 'test') ->> 'outcome', 'offered', '(b) 9 min into a 10 min prep: start_at has passed, first rider offered');
select is(pg_temp.live_rider('03'), pg_temp.uid('rb'), '(b) the nearest (193 s) rider rb holds the offer');
create temp table res (k text primary key, v jsonb);
grant all on res to public;
select tests.authenticate_as('pt_rb');
insert into res select 'dec', respond_to_dispatch_offer((select id from dispatch_offers where order_id = pg_temp.oid('03') and status = 'offered'), 'decline');
reset role;
select is((select v ->> 'outcome' from res where k = 'dec'), 'declined', '(b) rb declines');
select is(pg_temp.live_rider('03'), pg_temp.uid('rc'), '(b) rc is offered immediately in the same transaction');
select is((select count(*) from dispatch_offers where order_id = pg_temp.oid('03')), 2::bigint, '(b) two offers: declined + live');

-- ---------------------------------------------------------------------------
-- (c) riders do not answer: the buffer learns from history
-- ---------------------------------------------------------------------------

-- History: 5 accepted (10 s) and 20 expired (45 s) offers over 5 orders in the area = 25 answered offers.
insert into orders (id, customer_id, vendor_id, service_area_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo,
                    discount_kobo, total_kobo, delivery_address, delivery_location, accepted_at)
select ('ee000000-0000-7000-8000-00000000079' || g)::uuid, tests.get_supabase_uid('pt_customer'), 'ee000000-0000-7000-8000-000000000711',
       'ee000000-0000-7000-8000-000000000701', 'cancelled_by_platform', 'paid', 5000000, 50000, 100000, 0, 5150000,
       '{"line1": "H"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'), now() - interval '2 days'
from generate_series(1, 5) g;
create function pg_temp.history(p_expired_per_order int, p_accepted boolean) returns void language sql as $$
  insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at, responded_at)
  select ('ee000000-0000-7000-8000-00000000079' || g)::uuid, pg_temp.uid('rd'),
         case when a = 0 then 'accepted' else 'expired' end, 1, a + 1,
         now() - interval '1 day', now() - interval '1 day' + interval '45 seconds',
         now() - interval '1 day' + case when a = 0 then interval '10 seconds' else interval '45 seconds' end
  from generate_series(1, 5) g, generate_series(case when p_accepted then 0 else 1 end, p_expired_per_order) a
$$;
delete from dispatch_offers where order_id = pg_temp.oid('03');   -- scenario (b)'s answers are not history here
select _dispatch_area_stats_refresh('ee000000-0000-7000-8000-000000000701', true);
select is((select buffer_source || '/' || secure_buffer_s || '/' || buffer_samples from dispatch_area_stats where service_area_id = 'ee000000-0000-7000-8000-000000000701'), 'default/150/0', '(c) no history: the buffer is the setting (150 s)');
select pg_temp.history(1, false);   -- 5 expired only: below the 20 sample minimum
select _dispatch_area_stats_refresh('ee000000-0000-7000-8000-000000000701', true);
select is((select buffer_source || '/' || secure_buffer_s || '/' || buffer_samples from dispatch_area_stats where service_area_id = 'ee000000-0000-7000-8000-000000000701'), 'default/150/5', '(c) 5 samples < 20: still the setting');
delete from dispatch_offers where order_id::text like 'ee000000-0000-7000-8000-00000000079%';
select pg_temp.history(4, true);    -- 5 accepted + 20 expired
select _dispatch_area_stats_refresh('ee000000-0000-7000-8000-000000000701', true);
select is((select buffer_source || '/' || secure_buffer_s || '/' || buffer_samples from dispatch_area_stats where service_area_id = 'ee000000-0000-7000-8000-000000000701'), 'history/190/25',
  '(c) 25 samples: (1/0.2 - 1) x 45 s + 10 s = 190 s, from history, grown from 150');
select pg_temp.only('ra');
select pg_temp.accept('04');
select is((pg_temp.at('04')).start_at, now() + interval '1200 seconds' - interval '481 seconds' - interval '190 seconds', '(c) the next order starts 40 s earlier: +529 s');
select is((pg_temp.at('04')).start_basis ->> 'buffer_source', 'history', '(c) basis says buffer from history');
delete from dispatch_offers where order_id::text like 'ee000000-0000-7000-8000-00000000079%' and status = 'accepted';
select _dispatch_area_stats_refresh('ee000000-0000-7000-8000-000000000701', true);
select is((select secure_buffer_s from dispatch_area_stats where service_area_id = 'ee000000-0000-7000-8000-000000000701'), 900, '(c) nobody ever accepts: acceptance rate 0 is guarded and clamps to 900 s');
delete from dispatch_offers where order_id::text like 'ee000000-0000-7000-8000-00000000079%';
select _dispatch_area_stats_refresh('ee000000-0000-7000-8000-000000000701', true);
select is((select buffer_source || '/' || secure_buffer_s from dispatch_area_stats where service_area_id = 'ee000000-0000-7000-8000-000000000701'), 'default/150', '(c) history gone: back to the setting');

-- ---------------------------------------------------------------------------
-- Speed calibration from synthetic history
-- ---------------------------------------------------------------------------

insert into orders (id, customer_id, vendor_id, service_area_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo,
                    discount_kobo, total_kobo, delivery_address, delivery_location, accepted_at, rider_pickup_distance_m)
select ('ee000000-0000-7000-8000-0000000007' || (30 + g))::uuid, tests.get_supabase_uid('pt_customer'), 'ee000000-0000-7000-8000-000000000711',
       'ee000000-0000-7000-8000-000000000701', 'cancelled_by_platform', 'paid', 5000000, 50000, 100000, 0, 5150000,
       '{"line1": "H"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'), now() - interval '3 days', 3000
from generate_series(1, 20) g;
insert into order_dispatch (order_id, state, assigned_at, rider_arrived_vendor_at)
select ('ee000000-0000-7000-8000-0000000007' || (30 + g))::uuid, 'stopped', now() - interval '3 days',
       now() - interval '3 days' + interval '400 seconds'
from generate_series(1, 19) g;     -- 19 samples: 3000 m in 400 s = 27 km/h
select _dispatch_area_stats_refresh('ee000000-0000-7000-8000-000000000701', true);
select is((select speed_source || '/' || speed_samples from dispatch_area_stats where service_area_id = 'ee000000-0000-7000-8000-000000000701'), 'default/19', 'speed: 19 samples < 20 keeps the default');
select is(_estimate_travel_seconds(st_geogfromtext('POINT(7.5142 9.5)'), st_geogfromtext('POINT(7.5 9.5)'), 'ee000000-0000-7000-8000-000000000701'), 481,
  'speed: ETA unchanged at the default 18 km/h');

insert into order_dispatch (order_id, state, assigned_at, rider_arrived_vendor_at)
values (pg_temp.oid('50'), 'stopped', now() - interval '3 days', now() - interval '3 days' + interval '400 seconds');   -- the 20th sample
update orders set rider_pickup_distance_m = null where id = pg_temp.oid('31');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, distance_m, responded_at)
values (pg_temp.oid('31'), pg_temp.uid('rd'), 'accepted', 1, 1, 3000, now());        -- distance from the accepted offer instead
select _dispatch_area_stats_refresh('ee000000-0000-7000-8000-000000000701', true);
select is((select speed_source || '/' || speed_samples || '/' || speed_kmh from dispatch_area_stats where service_area_id = 'ee000000-0000-7000-8000-000000000701'), 'history/20/27.00',
  'speed: 20 samples (one uses the accepted offer''s distance): median 3000 m / 400 s = 27 km/h');
select is(_estimate_travel_seconds(st_geogfromtext('POINT(7.5142 9.5)'), st_geogfromtext('POINT(7.5 9.5)'), 'ee000000-0000-7000-8000-000000000701'), 341,
  'speed: ETA = 1559 m x 1.35 / 27 km/h + 60 = 341 s');
create function pg_temp.hist_dispatch(p_secs int) returns void language sql as $$
  update order_dispatch set rider_arrived_vendor_at = assigned_at + make_interval(secs => p_secs)
  where order_id in (select id from orders where id::text like 'ee000000-0000-7000-8000-00000000073%' or id::text like 'ee000000-0000-7000-8000-00000000074%' or id = pg_temp.oid('50')) $$;
select pg_temp.hist_dispatch(50);
select _dispatch_area_stats_refresh('ee000000-0000-7000-8000-000000000701', true);
select is((select speed_kmh from dispatch_area_stats where service_area_id = 'ee000000-0000-7000-8000-000000000701'), 40.00, 'speed: 60 km/h observed clamps to 40');
select is(_estimate_travel_seconds(st_geogfromtext('POINT(7.5142 9.5)'), st_geogfromtext('POINT(7.5 9.5)'), 'ee000000-0000-7000-8000-000000000701'), 249, 'speed: ETA at 40 km/h = 249 s');
select pg_temp.hist_dispatch(3000);
select _dispatch_area_stats_refresh('ee000000-0000-7000-8000-000000000701', true);
select is((select speed_kmh from dispatch_area_stats where service_area_id = 'ee000000-0000-7000-8000-000000000701'), 8.00, 'speed: 3.6 km/h observed clamps to 8');
select pg_temp.hist_dispatch(-10);
select _dispatch_area_stats_refresh('ee000000-0000-7000-8000-000000000701', true);
select is((select speed_source || '/' || speed_samples from dispatch_area_stats where service_area_id = 'ee000000-0000-7000-8000-000000000701'), 'default/0', 'speed: arrival before assignment (duration <= 0) is not counted');
delete from order_dispatch where order_id in (select id from orders where id::text like 'ee000000-0000-7000-8000-00000000073%' or id::text like 'ee000000-0000-7000-8000-00000000074%' or id = pg_temp.oid('50'));
delete from dispatch_offers where order_id = pg_temp.oid('31');
select _dispatch_area_stats_refresh('ee000000-0000-7000-8000-000000000701', true);

-- the cache is staleness-gated
update dispatch_area_stats set speed_samples = 999 where service_area_id = 'ee000000-0000-7000-8000-000000000701';
select _dispatch_area_stats_refresh('ee000000-0000-7000-8000-000000000701');
select is((select speed_samples from dispatch_area_stats where service_area_id = 'ee000000-0000-7000-8000-000000000701'), 999, 'cache: a fresh row (< 10 min) is not recomputed');
update dispatch_area_stats set refreshed_at = now() - interval '11 minutes' where service_area_id = 'ee000000-0000-7000-8000-000000000701';
select _dispatch_area_stats_refresh('ee000000-0000-7000-8000-000000000701');
select is((select speed_samples from dispatch_area_stats where service_area_id = 'ee000000-0000-7000-8000-000000000701'), 0, 'cache: a stale row is recomputed');
delete from dispatch_area_stats where service_area_id = 'ee000000-0000-7000-8000-000000000701';
select pg_temp.tick('04');
select is((select count(*) from dispatch_area_stats where service_area_id = 'ee000000-0000-7000-8000-000000000701'), 1::bigint, 'cache: the tick creates the missing row');

-- ---------------------------------------------------------------------------
-- No candidates -> default travel; the tick's recompute cadence
-- ---------------------------------------------------------------------------

select pg_temp.only(variadic '{}'::text[]);
select pg_temp.accept('20');
select is((pg_temp.at('20')).start_at, now() + interval '450 seconds', 'no eligible rider: start_at = +1200 - 600 (default travel) - 150 = +450 s');
select is((pg_temp.at('20')).start_basis ->> 'travel_source' || '/' || ((pg_temp.at('20')).start_basis ->> 'candidates_used'), 'default/0', 'basis: default travel, 0 candidates');

select pg_temp.only('ra');
select pg_temp.accept('05');
select is((pg_temp.at('05')).start_at, now() + interval '569 seconds', 'cadence: start +569 s with ra (481 s)');
select pg_temp.tick('05');
select is(pg_temp.ev('05', 'start_recomputed'), 0::bigint, 'cadence: a tick within 60 s does not recompute');
select pg_temp.move('ra', 0.0045);
select pg_temp.tick('05');
select is(pg_temp.ev('05', 'start_recomputed'), 0::bigint, 'cadence: still throttled although the rider moved');
select pg_temp.age_basis('05');
select pg_temp.tick('05');
select is((pg_temp.at('05')).start_at, now() + interval '857 seconds', 'cadence: after 60 s the rider is 193 s away: start +1200 - 193 - 150 = +857 s');
select is(pg_temp.ev('05', 'start_recomputed'), 1::bigint, 'cadence: a move of 288 s logs start_recomputed');
select pg_temp.move('ra', 0.0046);
select pg_temp.age_basis('05');
select pg_temp.tick('05');
select is((pg_temp.at('05')).start_basis ->> 'travel_s', _estimate_travel_seconds(st_geogfromtext('POINT(7.5046 9.5)'), st_geogfromtext('POINT(7.5 9.5)'), null)::text,
  'cadence: a small move still refreshes the basis');
select is(pg_temp.ev('05', 'start_recomputed'), 1::bigint, 'cadence: a move under 30 s logs nothing');
select is((pg_temp.at('05')).next_check_at, now() + interval '60 seconds', 'cadence: next look in 60 s');
select pg_temp.move('ra', 0.0142);

-- ---------------------------------------------------------------------------
-- (d) prep delayed after accept: the vendor update moves the ready time and tells the rider
-- ---------------------------------------------------------------------------

select pg_temp.only('ra');
select pg_temp.accept('06');
update orders set rider_id = pg_temp.uid('rd') where id = pg_temp.oid('06');
select is((pg_temp.at('06')).state, 'assigned', '(d) the order is assigned to rd');
insert into res select 'd1', pg_temp.as_user('pt_vendor', format('select vendor_update_prep_estimate(%L, 35)::text', pg_temp.oid('06')))::jsonb;
select is((select v ->> 'rider_notified' from res where k = 'd1'), 'true', '(d) delay of 15 min: rider notified');
select is((select (v ->> 'expected_ready_at')::timestamptz from res where k = 'd1'), now() + interval '35 minutes', '(d) expected_ready_at = now + 35 min');
select is((pg_temp.at('06')).expected_ready_at, now() + interval '35 minutes', '(d) stored on order_dispatch');
select is((select title || ' | ' || body from rider_notifications where order_id = pg_temp.oid('06') and rider_id = pg_temp.uid('rd')),
  'Food will be ready later | Order ' || (select code from orders where id = pg_temp.oid('06')) || ': food should be ready at about '
  || to_char((now() + interval '35 minutes') at time zone 'Africa/Lagos', 'HH24:MI') || '.',
  '(d) rider_notifications row with the new Lagos time');
select is((select channel || '/' || category || '/' || kind || '/' || (data ->> 'type') || '/' || (data ->> 'orderId') || '/' || recipient_user_id::text
           from message_outbox where dedupe_key = 'order:' || pg_temp.oid('06')::text || ':prep:1'),
  'push/transactional/system/order_prep_update/' || pg_temp.oid('06')::text || '/' || pg_temp.uid('rd')::text, '(d) transactional push queued in the outbox');
select is((select data from dispatch_events where order_id = pg_temp.oid('06') and event = 'prep_estimate_changed'),
  jsonb_build_object('old', now() + interval '20 minutes', 'new', now() + interval '35 minutes', 'ready_in_minutes', 35), '(d) prep_estimate_changed {old,new}');
insert into res select 'd2', pg_temp.as_user('pt_vendor', format('select vendor_update_prep_estimate(%L, 36)::text', pg_temp.oid('06')))::jsonb;
select is((select v ->> 'rider_notified' from res where k = 'd2'), 'false', '(d) a 1 min change does not bother the rider');
select is((select count(*) from rider_notifications where order_id = pg_temp.oid('06')), 1::bigint, '(d) ... no second notification row');
insert into res select 'd3', pg_temp.as_user('pt_vendor', format('select vendor_update_prep_estimate(%L, 20)::text', pg_temp.oid('06')))::jsonb;
select is((select title from rider_notifications where order_id = pg_temp.oid('06') order by created_at desc, id desc limit 1), 'Food will be ready sooner', '(d) 16 min earlier: "sooner"');
select is((select count(*) from message_outbox where dedupe_key like 'order:' || pg_temp.oid('06')::text || ':prep:%'), 2::bigint, '(d) outbox dedupe keys :prep:1 and :prep:3');

-- not yet dispatching: start_at follows
select pg_temp.only('ra');
select pg_temp.accept('09');
insert into res select 'd4', pg_temp.as_user('pt_vendor', format('select vendor_update_prep_estimate(%L, 40)::text', pg_temp.oid('09')))::jsonb;
select is((select (v ->> 'start_at')::timestamptz from res where k = 'd4'), now() + interval '2400 seconds' - interval '631 seconds', '(d) scheduled order: start_at recomputed to +1769 s');
select is((select v ->> 'rider_notified' from res where k = 'd4'), 'false', '(d) no rider yet, nobody notified');
select is(pg_temp.ev('09', 'start_recomputed'), 1::bigint, '(d) start_recomputed logged');

-- guards
select is(pg_temp.as_user('pt_other', format('select vendor_update_prep_estimate(%L, 15)::text', pg_temp.oid('09'))), 'ERR:42501', 'guard: another account cannot change it');
select is(pg_temp.as_user('pt_vendor', format('select vendor_update_prep_estimate(%L, 0)::text', pg_temp.oid('09'))), 'ERR:23514', 'guard: 0 minutes rejected');
select is(pg_temp.as_user('pt_vendor', format('select vendor_update_prep_estimate(%L, 181)::text', pg_temp.oid('09'))), 'ERR:23514', 'guard: 181 minutes rejected');
select pg_temp.mk_order('21', 'ready_for_pickup');
select is(pg_temp.as_user('pt_vendor', format('select vendor_update_prep_estimate(%L, 15)::text', pg_temp.oid('21'))), 'ERR:23514', 'guard: a ready order is rejected');
select pg_temp.mk_order('22', 'accepted', '711', '0', null, 'vendor');
select is(pg_temp.as_user('pt_vendor', format('select vendor_update_prep_estimate(%L, 15)::text', pg_temp.oid('22'))), 'ERR:23514', 'guard: self-delivery order rejected');
select pg_temp.accept('08');
select pg_temp.as_user('pt_vendor', format('select vendor_update_prep_estimate(%L, %s)::text', pg_temp.oid('08'), 20 + g)) from generate_series(1, 10) g;
select is(pg_temp.ev('08', 'prep_estimate_changed'), 10::bigint, 'cap: ten updates are accepted');
select is(pg_temp.as_user('pt_vendor', format('select vendor_update_prep_estimate(%L, 15)::text', pg_temp.oid('08'))), 'ERR:P0429', 'cap: the eleventh is refused');

-- ---------------------------------------------------------------------------
-- (e) ready early
-- ---------------------------------------------------------------------------

select pg_temp.accept('10');
update orders set rider_id = pg_temp.uid('re') where id = pg_temp.oid('10');
update orders set status = 'ready_for_pickup', ready_at = now() where id = pg_temp.oid('10');
select is((select status::text from orders where id = pg_temp.oid('10')), 'rider_assigned', '(e) the 0064 cascade still moves the pre-assigned order to rider_assigned');
select is((select title || ' | ' || body from rider_notifications where order_id = pg_temp.oid('10') and rider_id = pg_temp.uid('re') and title like 'Food is%'),
  'Food is ready now | Order ' || (select code from orders where id = pg_temp.oid('10')) || ': the food is ready for pickup.', '(e) rider told the food is ready');
select is((select data::text from message_outbox where dedupe_key = 'order:' || pg_temp.oid('10')::text || ':ready'),
  jsonb_build_object('type', 'order_ready', 'orderId', pg_temp.oid('10'))::text, '(e) push queued with {type: order_ready, orderId}');
select is((select data ->> 'early_seconds' from dispatch_events where order_id = pg_temp.oid('10') and event = 'ready_early'), '1200', '(e) ready_early logged, 1200 s early');
select pg_temp.accept('11');
update orders set rider_id = pg_temp.uid('rf') where id = pg_temp.oid('11');
update order_dispatch set expected_ready_at = now() + interval '1 minute' where order_id = pg_temp.oid('11');
update orders set status = 'ready_for_pickup', ready_at = now() where id = pg_temp.oid('11');
select is(pg_temp.ev('11', 'ready_early') + (select count(*) from rider_notifications where order_id = pg_temp.oid('11')), 0::bigint, '(e) ready only 1 min early: no message, no event');
select is((select status::text from orders where id = pg_temp.oid('11')), 'rider_assigned', '(e) ... and the cascade still works');

-- ---------------------------------------------------------------------------
-- Overrun: the ready time slides, the rider is not told
-- ---------------------------------------------------------------------------

select pg_temp.only('ra');
select pg_temp.accept('12');
update order_dispatch set expected_ready_at = now() - interval '6 minutes' where order_id = pg_temp.oid('12');
select pg_temp.tick('12');
select is((pg_temp.at('12')).expected_ready_at, now() + interval '5 minutes', 'overrun: 6 min late slides expected_ready_at to now + 5 min');
select is((select data from dispatch_events where order_id = pg_temp.oid('12') and event = 'prep_overrun'),
  jsonb_build_object('old', now() - interval '6 minutes', 'new', now() + interval '5 minutes'), 'overrun: prep_overrun {old,new}');
select is((select count(*) from rider_notifications where order_id = pg_temp.oid('12')) + (select count(*) from message_outbox where data ->> 'orderId' = pg_temp.oid('12')::text and data ->> 'type' in ('order_prep_update', 'order_ready')),
  0::bigint, 'overrun: no rider notification');
select is((pg_temp.at('12')).state, 'offered', 'overrun: start_at fell back to accepted_at, the order is being offered');
update order_dispatch set expected_ready_at = now() - interval '6 minutes' where order_id = pg_temp.oid('12');
select pg_temp.tick('12');
select is(pg_temp.ev('12', 'prep_overrun'), 2::bigint, 'overrun: a dispatching order slides too');
select pg_temp.accept('13');
update order_dispatch set expected_ready_at = now() - interval '4 minutes' where order_id = pg_temp.oid('13');
select pg_temp.tick('13');
select is((pg_temp.at('13')).expected_ready_at, now() - interval '4 minutes', 'overrun: 4 min late is left alone');

-- ---------------------------------------------------------------------------
-- (f) the rider's ETA grows after assignment: an event, never a reassignment
-- ---------------------------------------------------------------------------

select pg_temp.only(variadic '{}'::text[]);
select pg_temp.accept('15');
update orders set rider_id = pg_temp.uid('rb') where id = pg_temp.oid('15');
select _dispatch_stamp_assigned_eta(pg_temp.oid('15'));
select is(extract(epoch from ((pg_temp.at('15')).assigned_eta_at - now()))::int, 193, '(f) assigned ETA stamped: 193 s');
update order_dispatch set expected_ready_at = now() + interval '60 seconds', eta_updated_at = now() - interval '31 seconds' where order_id = pg_temp.oid('15');
select tests.authenticate_as('pt_rb');
select update_rider_location(9.5, 7.56);
reset role;
select is((pg_temp.at('15')).current_eta_at, now() + interval '1839 seconds', '(f) rider now 1839 s away: current_eta_at refreshed');
select is((select data ->> 'step' from dispatch_events where order_id = pg_temp.oid('15') and event = 'eta_increased'), '5', '(f) eta_increased logged (step 5 = (1839-193)/300)');
select is((select rider_id from orders where id = pg_temp.oid('15')), pg_temp.uid('rb'), '(f) still the same rider');
select is((select count(*) from dispatch_offers where order_id = pg_temp.oid('15')), 0::bigint, '(f) nothing reassigned or re-offered');
select is((pg_temp.at('15')).state, 'assigned', '(f) state stays assigned');
select tests.authenticate_as('pt_rb');
select update_rider_location(9.5, 7.56);
reset role;
select is(pg_temp.ev('15', 'eta_increased'), 1::bigint, '(f) a ping within 30 s changes nothing');
update order_dispatch set eta_updated_at = now() - interval '31 seconds' where order_id = pg_temp.oid('15');
select tests.authenticate_as('pt_rb');
select update_rider_location(9.5, 7.5601);
reset role;
select is(pg_temp.ev('15', 'eta_increased'), 1::bigint, '(f) the same 5-min step is not logged twice');
update order_dispatch set eta_updated_at = now() - interval '31 seconds' where order_id = pg_temp.oid('15');
select tests.authenticate_as('pt_rb');
select update_rider_location(9.5, 7.62);
reset role;
select is(pg_temp.ev('15', 'eta_increased'), 2::bigint, '(f) the next step (3618 s away) is logged');
select is((select max((data ->> 'step')::int) from dispatch_events where order_id = pg_temp.oid('15') and event = 'eta_increased'), 11, '(f) step 11');

select pg_temp.accept('16');
update orders set rider_id = pg_temp.uid('rg') where id = pg_temp.oid('16');
select _dispatch_stamp_assigned_eta(pg_temp.oid('16'));
update order_dispatch set expected_ready_at = now() + interval '60 seconds', eta_updated_at = now() - interval '31 seconds' where order_id = pg_temp.oid('16');
select tests.authenticate_as('pt_rg');
select update_rider_location(9.5, 7.509);     -- 327 s: only +134 s, under the 5 min margin
reset role;
select is(pg_temp.ev('16', 'eta_increased'), 0::bigint, '(f) +134 s is under 5 minutes: no event');
update order_dispatch set expected_ready_at = now() + interval '2 hours', eta_updated_at = now() - interval '31 seconds' where order_id = pg_temp.oid('16');
select tests.authenticate_as('pt_rg');
select update_rider_location(9.5, 7.62);      -- 3618 s but the food is not ready for 2 hours
reset role;
select is(pg_temp.ev('16', 'eta_increased'), 0::bigint, '(f) later than assigned but before the food is ready: no event');

-- ---------------------------------------------------------------------------
-- Arrival stamp
-- ---------------------------------------------------------------------------

select pg_temp.mk_order('17', 'rider_assigned', '711', '10 minutes', 'ro');
update orders set ready_at = now() - interval '120 seconds' where id = pg_temp.oid('17');
insert into order_dispatch (order_id, state, assigned_at, assigned_eta_at, expected_ready_at)
values (pg_temp.oid('17'), 'assigned', now() - interval '5 minutes', now() + interval '200 seconds', now() - interval '2 minutes');
select tests.authenticate_as('pt_ro');
select update_rider_location(9.5, 7.5018);    -- 198 m: outside 100 m
reset role;
select is((pg_temp.at('17')).rider_arrived_vendor_at, null, 'arrival: 198 m away is not at the vendor');
select tests.authenticate_as('pt_ro');
select update_rider_location(9.5, 7.5005);    -- 55 m
reset role;
select is((pg_temp.at('17')).rider_arrived_vendor_at, now(), 'arrival: the first ping within 100 m stamps rider_arrived_vendor_at');
select is((select data ->> 'wait_seconds' from dispatch_events where order_id = pg_temp.oid('17') and event = 'rider_at_vendor'), '120',
  'arrival: rider_at_vendor with wait_seconds = arrival - ready_at = 120');
update order_dispatch set rider_arrived_vendor_at = now() - interval '1 minute' where order_id = pg_temp.oid('17');
select tests.authenticate_as('pt_ro');
select update_rider_location(9.5, 7.5004);
reset role;
select is((pg_temp.at('17')).rider_arrived_vendor_at, now() - interval '1 minute', 'arrival: a later ping never re-stamps');
select is(pg_temp.ev('17', 'rider_at_vendor'), 1::bigint, 'arrival: logged once');
select is((select st_x(current_location::geometry) from riders where user_id = pg_temp.uid('ro')), 7.5004::float8, 'update_rider_location still updates the rider location');

-- ---------------------------------------------------------------------------
-- (g) nobody can arrive before the food is ready
-- ---------------------------------------------------------------------------

select pg_temp.only('rfar');       -- ro, rb, ... offline; rbusy is online but busy below
update riders set is_online = true where user_id = pg_temp.uid('rbusy');
select pg_temp.mk_order('19', 'rider_assigned', '711', '0', 'rbusy');
select pg_temp.accept('18', '713');
select is((pg_temp.at('18')).start_basis ->> 'travel_s', '3618', '(g) the only eligible rider is 3618 s away (prep is 5 min)');
select is((pg_temp.at('18')).start_at, now(), '(g) start_at clamps to accepted_at');
select is(_dispatch_advance(pg_temp.oid('18'), 'test') ->> 'outcome', 'offered', '(g) the order is offered at once');
select is(pg_temp.live_rider('18'), pg_temp.uid('rfar'), '(g) to the eligible rider, not the offline (ro, rb) or busy (rbusy) ones');
select is((select count(*) from dispatch_offers where order_id = pg_temp.oid('18')), 1::bigint, '(g) exactly one offer');

select * from finish();
rollback;
