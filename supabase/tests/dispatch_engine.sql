-- pgTAP: the sequential dispatch engine (0101): _dispatch_advance, H3 candidate
-- discovery, ETA ranking, order lifecycle triggers and the rewired entry points.
--
-- What this protects:
-- (1) ONE live offer per order, to the nearest-by-ETA eligible rider; a re-run
--     never double-offers.
-- (2) A lapsed live offer is closed (expired) and the next rider asked; a live
--     offer whose rider went offline is cancelled (rider_unavailable).
-- (3) Eligibility: busy, stale-ping, unapproved, unfundable, declined and
--     "holding a live offer elsewhere" riders are never candidates.
-- (4) Discovery: rings expand from dispatch_h3_initial_ring; after the last ring
--     the PostGIS fallback finds the rest; the radius cap and 0098 widening
--     apply.
-- (5) Nobody to ask: funnel row, vendor notice (after the threshold),
--     needs_attention. A used-up cycle starts a new one that re-asks expired
--     riders but never declined ones.
-- (6) Not dispatchable (before start_at, self-delivery, cancelled) closes the
--     live offer; vendor accept creates order_dispatch with start_at.
-- (7) Wrappers keep their shapes.
--
-- Geometry: the vendor sits at POINT(7.5 9.5). One degree of longitude there is
-- ~109.8 km, so riders east of it at +0.0045 / +0.009 / +0.02 / +0.06 / +0.12
-- degrees are ~0.5 / 1.0 / 2.2 / 6.6 / 13 km away (H3 res 8 rings are ~0.9 km
-- wide, max ring 8 reaches ~7 km). Big orders can fund any rider fee; small
-- ones fund only riders within ~2 km (rider fee 50,000 + 15,000 per started km
-- against a 75,000 ceiling).

begin;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('de_customer');
select tests.create_supabase_user('de_vendor');
select tests.create_supabase_user('de_' || n) from unnest(array['r1', 'r2', 'r3', 'r4', 'r5', 'rf', 'rb', 'rs', 'rd', 'rl', 'rk']) n;

insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
values ('ee000000-0000-7000-8000-000000000401', 'DE Area',
        st_geogfromtext('POLYGON((7.0 9.0, 8.5 9.0, 8.5 10.0, 7.0 10.0, 7.0 9.0))'), true, 50000, 15000, 50000, 15000);

insert into vendors (id, owner_user_id, name, slug, status, location, commission_bps, delivery_radius_m, avg_prep_mins) values
  ('ee000000-0000-7000-8000-000000000411', tests.get_supabase_uid('de_vendor'), 'DE V1', 'de-v1', 'active', st_geogfromtext('POINT(7.5 9.5)'), 1500, 20000, 20),
  ('ee000000-0000-7000-8000-000000000412', tests.get_supabase_uid('de_vendor'), 'DE V2 quick', 'de-v2', 'active', st_geogfromtext('POINT(7.5 9.5)'), 1500, 20000, 5);

insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
select tests.get_supabase_uid('de_' || n), true, 'approved', st_geogfromtext('POINT(' || (7.5 + dx) || ' 9.5)'), now()
from (values ('r1', 0.0045), ('r2', 0.009), ('r3', 0.02), ('r4', 0.06), ('r5', 0.12),
             ('rf', 0.0075), ('rb', 0.0040), ('rs', 0.0042), ('rd', 0.0044), ('rl', 0.0046), ('rk', 0.0048)) as t(n, dx);

create function pg_temp.uid(p text) returns uuid language sql as $$ select tests.get_supabase_uid('de_' || p) $$;
create function pg_temp.oid(p_n text) returns uuid language sql as $$ select ('ee000000-0000-7000-8000-0000000004' || p_n)::uuid $$;

-- p_ready_ago: how long ago it became ready / was accepted. Small orders fund only near riders.
create function pg_temp.mk_order(p_n text, p_status order_status default 'ready_for_pickup', p_small boolean default false,
                                 p_vendor text default '411', p_ready_ago interval default '0', p_delivery_by text default 'rider',
                                 p_rider text default null)
returns void language sql as $$
  insert into orders (id, customer_id, vendor_id, service_area_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo,
                      discount_kobo, total_kobo, delivery_address, delivery_location, rider_id, ready_at, accepted_at, first_dispatched_at, delivery_by)
  values (pg_temp.oid(p_n), tests.get_supabase_uid('de_customer'), ('ee000000-0000-7000-8000-000000000' || p_vendor)::uuid,
          'ee000000-0000-7000-8000-000000000401', p_status, 'paid',
          case when p_small then 100000 else 5000000 end, 50000, case when p_small then 10000 else 100000 end, 0,
          case when p_small then 160000 else 5150000 end,
          '{"line1": "1 DE Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'),
          case when p_rider is null then null else pg_temp.uid(p_rider) end,
          case when p_status = 'ready_for_pickup' then now() - p_ready_ago end,
          case when p_status in ('placed', 'draft') then null else now() - p_ready_ago end,
          case when p_status = 'ready_for_pickup' then now() - p_ready_ago end,
          p_delivery_by);
$$;

-- Fresh slate between scenarios: no offers, only the named riders online.
create function pg_temp.only(variadic p_names text[]) returns void language sql as $$
  delete from dispatch_offers;
  update riders set is_online = exists (select 1 from unnest(p_names) n where pg_temp.uid(n) = riders.user_id), last_ping_at = now();
$$;

create function pg_temp.adv(p_n text, p_widen boolean default false) returns jsonb language sql as $$
  select _dispatch_advance(pg_temp.oid(p_n), 'test', p_widen) $$;
create function pg_temp.live_rider(p_n text) returns uuid language sql as $$
  select rider_id from dispatch_offers where order_id = pg_temp.oid(p_n) and status = 'offered' $$;
create function pg_temp.cnt(p_n text, p_status text default null) returns bigint language sql as $$
  select count(*) from dispatch_offers where order_id = pg_temp.oid(p_n) and (p_status is null or status = p_status) $$;
create function pg_temp.ev(p_n text, p_event text) returns bigint language sql as $$
  select count(*) from dispatch_events where order_id = pg_temp.oid(p_n) and event = p_event $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege(r.role, f.sig, 'execute'), format('%s cannot execute internal %s', r.role, f.sig))
from (values ('_estimate_travel_seconds(geography, geography, uuid)'), ('_dispatch_start_at(orders, timestamptz)'),
             ('_dispatch_candidates(uuid, integer, integer, integer, integer)'), ('_dispatch_advance(uuid, text, boolean)'),
             ('_dispatch_rider_available(uuid)'), ('_dispatch_rider_excluded(uuid, uuid, integer)'),
             ('_dispatch_close_live_offer(uuid, text, text)')) as f(sig)
cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role);

-- ---------------------------------------------------------------------------
-- ETA: the one seam
-- ---------------------------------------------------------------------------

select is(_estimate_travel_seconds(st_geogfromtext('POINT(7.5 9.5)'), st_geogfromtext('POINT(7.509 9.5)'), null),
  (round(st_distance(st_geogfromtext('POINT(7.5 9.5)'), st_geogfromtext('POINT(7.509 9.5)')) * 1.35 / 5.0) + 60)::integer,
  'ETA = metres x 135% / 18 km/h + 60 s overhead');
select is(_estimate_travel_seconds(null, st_geogfromtext('POINT(7.5 9.5)'), null), null, 'ETA of an unknown position is null');

-- ---------------------------------------------------------------------------
-- 1. Nearest-by-ETA gets the single offer; a re-run does not double-offer
-- ---------------------------------------------------------------------------

select pg_temp.only('r1', 'r2', 'r3');
select pg_temp.mk_order('01');
create temp table res (k text primary key, v jsonb);
grant all on res to public;
insert into res values ('o1', pg_temp.adv('01'));

select is(((select v from res where k = 'o1') ->> 'outcome'), 'offered', 'ready order: outcome offered');
select is(pg_temp.live_rider('01'), pg_temp.uid('r1'), 'the nearest rider (r1) holds the offer');
select is(pg_temp.cnt('01'), 1::bigint, 'exactly one offer row, not a batch');
select is((select d.cycle_no || '/' || d.attempt_no from dispatch_offers d where d.order_id = pg_temp.oid('01')), '1/1', 'cycle 1, attempt 1');
select ok((select expires_at = offered_at + interval '45 seconds' and eta_seconds > 60 and distance_m between 400 and 600
                  and ring is not null and radius_m is null
           from dispatch_offers where order_id = pg_temp.oid('01')),
  'offer carries a 45 s TTL, ETA, distance, ring and no radius cap');
select is((select state || '/' || cycle_no || '/' || attempt_no from order_dispatch where order_id = pg_temp.oid('01')), 'offered/1/1',
  'order_dispatch created (recovery) and tracks the offer');
select is((select next_check_at from order_dispatch where order_id = pg_temp.oid('01')),
  (select expires_at from dispatch_offers where order_id = pg_temp.oid('01')), 'next_check_at = offer expiry');
select is(pg_temp.ev('01', 'offer_created') || '/' || pg_temp.ev('01', 'cycle_started'), '1/1', 'events: offer_created and cycle_started');

select is((pg_temp.adv('01') ->> 'outcome'), 'waiting', 're-run with a live offer: waiting');
select is(pg_temp.cnt('01'), 1::bigint, 're-run created no second offer');
select is(pg_temp.cnt('01', 'offered'), 1::bigint, 'still exactly one live offer');

select is((select array_agg(c.rider_id order by c.eta_seconds) from _dispatch_candidates(pg_temp.oid('01'), 10, null, 1, 3) c),
  array[pg_temp.uid('r2'), pg_temp.uid('r3')], 'ranked by ETA (r1 holds the live offer so it is excluded here)');
select is((select c.fee_kobo from _dispatch_candidates(pg_temp.oid('01'), 10, null, 1, 3) c where c.rider_id = pg_temp.uid('r2')),
  (select fee_kobo from _quote_rider_fee(pg_temp.oid('01'), pg_temp.uid('r2'))), 'candidate fee = _quote_rider_fee');

-- ---------------------------------------------------------------------------
-- 2. An expired live offer is closed and the next rider asked
-- ---------------------------------------------------------------------------

select pg_temp.only('r1', 'r2');
select pg_temp.mk_order('02');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
values (pg_temp.oid('02'), pg_temp.uid('r1'), 'offered', 1, 1, now() - interval '2 minutes', now() - interval '1 minute');
insert into res values ('o2', pg_temp.adv('02'));

select is(((select v from res where k = 'o2') ->> 'outcome') || '/' || ((select v from res where k = 'o2') ->> 'offers_expired'), 'offered/1',
  'lapsed offer closed, next rider offered');
select is((select status || '/' || close_reason from dispatch_offers where order_id = pg_temp.oid('02') and rider_id = pg_temp.uid('r1')),
  'expired/timeout', 'r1''s offer is expired (timeout)');
select is(pg_temp.live_rider('02'), pg_temp.uid('r2'), 'r2 now holds the live offer (r1 was already asked this cycle)');
select is((select cycle_no || '/' || attempt_no from dispatch_offers where order_id = pg_temp.oid('02') and status = 'offered'), '1/2',
  'attempt numbers continue from the existing offer');
select is(pg_temp.ev('02', 'offer_expired'), 1::bigint, 'event offer_expired logged');

-- ---------------------------------------------------------------------------
-- 3. A live offer whose rider went offline is cancelled
-- ---------------------------------------------------------------------------

select pg_temp.only('r1', 'r2');
select pg_temp.mk_order('03');
select pg_temp.adv('03');
select is(pg_temp.live_rider('03'), pg_temp.uid('r1'), 'r1 is offered first');
update riders set is_online = false where user_id = pg_temp.uid('r1');
select is((pg_temp.adv('03') ->> 'outcome'), 'offered', 'after r1 goes offline the engine moves on');
select is((select status || '/' || close_reason from dispatch_offers where order_id = pg_temp.oid('03') and rider_id = pg_temp.uid('r1')),
  'cancelled/rider_unavailable', 'r1''s offer is cancelled with rider_unavailable');
select is(pg_temp.live_rider('03'), pg_temp.uid('r2'), 'r2 is offered next');
select is(pg_temp.ev('03', 'offer_cancelled'), 1::bigint, 'event offer_cancelled logged');

-- ---------------------------------------------------------------------------
-- 4. Eligibility filters
-- ---------------------------------------------------------------------------

select pg_temp.only('rf', 'rb', 'rs', 'rd', 'rl', 'rk', 'r4');
select pg_temp.mk_order('04', 'ready_for_pickup', true);
select pg_temp.mk_order('05', 'rider_assigned', false, '411', '0', 'rider', 'rb');        -- rb is busy
select pg_temp.mk_order('06');                                                              -- rl holds a live offer here
update riders set last_ping_at = now() - interval '10 minutes' where user_id = pg_temp.uid('rs');
update riders set kyc_status = 'pending' where user_id = pg_temp.uid('rk');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no)
values (pg_temp.oid('04'), pg_temp.uid('rd'), 'declined', 1, 1);
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, expires_at)
values (pg_temp.oid('06'), pg_temp.uid('rl'), 'offered', 1, 1, now() + interval '30 seconds');

create temp table cands as select c.* from _dispatch_candidates(pg_temp.oid('04'), 10, null, 1, 20) c;
select is((select count(*) from cands), 1::bigint, 'only one of seven riders survives the filters');
select is((select rider_id from cands), pg_temp.uid('rf'), 'the survivor is the plain eligible rider');
select ok(not exists (select 1 from cands where rider_id = pg_temp.uid('rb')), 'busy rider (active order) excluded');
select ok(not exists (select 1 from cands where rider_id = pg_temp.uid('rs')), 'stale-ping rider excluded');
select ok(not exists (select 1 from cands where rider_id = pg_temp.uid('rk')), 'KYC-pending rider excluded');
select ok(not exists (select 1 from cands where rider_id = pg_temp.uid('rd')), 'declined rider excluded');
select ok(not exists (select 1 from cands where rider_id = pg_temp.uid('rl')), 'rider holding a live offer elsewhere excluded');
select ok(not exists (select 1 from cands where rider_id = pg_temp.uid('r4')), 'unfundable rider (6.6 km on a small order) excluded');
select is((select count(*) from _dispatch_candidates(pg_temp.oid('04'), null, null, 1, 20) where rider_id <> pg_temp.uid('rf')), 0::bigint,
  'the beyond_rings fallback applies the same filters');

-- ---------------------------------------------------------------------------
-- 5. Ring expansion
-- ---------------------------------------------------------------------------

select pg_temp.only('r3');
select pg_temp.mk_order('07');
insert into res values ('o7', pg_temp.adv('07'));
select is(((select v from res where k = 'o7') ->> 'outcome') || '/' || ((select v from res where k = 'o7') ->> 'stage'), 'offered/rings',
  'a rider 2.2 km away is found through the rings');
select cmp_ok((select ring from dispatch_offers where order_id = pg_temp.oid('07')), '>', 1, 'found only beyond the initial ring 1');
select is((select ring from dispatch_offers where order_id = pg_temp.oid('07')),
  (select g.k from h3_grid_disk_distances(h3_latlng_to_cell(9.5, 7.5, 8), 12) g
   where g.cell = h3_cell_to_parent((select h3_cell from riders where user_id = pg_temp.uid('r3')), 8)),
  'the offer''s ring is the rider''s true H3 grid distance from the vendor cell');
select is(pg_temp.ev('07', 'ring_expanded'), 1::bigint, 'event ring_expanded logged');
select is((select ring from order_dispatch where order_id = pg_temp.oid('07')), (select ring from dispatch_offers where order_id = pg_temp.oid('07')),
  'order_dispatch.ring follows the offer');

-- ---------------------------------------------------------------------------
-- 6. Max ring, then the beyond_rings fallback; radius cap and widening
-- ---------------------------------------------------------------------------

select pg_temp.only('r5');
select pg_temp.mk_order('08');
insert into res values ('o8', pg_temp.adv('08'));
select is(((select v from res where k = 'o8') ->> 'outcome') || '/' || ((select v from res where k = 'o8') ->> 'stage'), 'offered/beyond_rings',
  'a rider 13 km away (outside the 8 rings) is found by the fallback, uncapped');
select is((select ring from dispatch_offers where order_id = pg_temp.oid('08')), null, 'a fallback offer has no ring');

select pg_temp.only('r5');
select pg_temp.mk_order('09');
update platform_settings set value_int = 5000 where key = 'dispatch_radius_m';
insert into res values ('o9', pg_temp.adv('09'));
select is((select v ->> 'outcome' || '/' || (v ->> 'tier') || '/' || (v ->> 'radius_m') from res where k = 'o9'), 'no_candidates/base/5000',
  'radius cap 5 km: the 13 km rider is out of reach');
insert into res values ('o9f', pg_temp.adv('09', true));
select is((select v ->> 'outcome' || '/' || (v ->> 'tier') || '/' || (v ->> 'radius_m') from res where k = 'o9f'), 'offered/widened/20000',
  'forced widening goes to the store''s own radius (0098) and finds the rider');
select is((select radius_m from dispatch_offers where order_id = pg_temp.oid('09') and status = 'offered'), 20000, 'offer records the radius used');
update platform_settings set value_int = 0 where key = 'dispatch_radius_m';

-- ---------------------------------------------------------------------------
-- 7. Nobody to ask
-- ---------------------------------------------------------------------------

select pg_temp.only('customer');  -- nobody online (the customer is not a rider)
select pg_temp.mk_order('10');
insert into res values ('o10', pg_temp.adv('10'));
select is((select v ->> 'outcome' from res where k = 'o10'), 'no_candidates', 'no rider online: no_candidates');
select is((select tier || '/' || online_riders || '/' || riders_in_range || '/' || offers_created from dispatch_attempts where order_id = pg_temp.oid('10')),
  'base/0/0/0', 'the funnel is recorded in dispatch_attempts');
select is((select state from order_dispatch where order_id = pg_temp.oid('10')), 'searching', 'state searching, retry scheduled');
select ok((select next_check_at between now() + interval '14 seconds' and now() + interval '16 seconds' from order_dispatch where order_id = pg_temp.oid('10')),
  'next check in 15 s');
select is((select count(*) from notifications where order_id = pg_temp.oid('10') and kind = 'no_rider_nearby'), 0::bigint,
  'no vendor notice before the threshold');
select is(pg_temp.ev('10', 'no_candidates'), 1::bigint, 'event no_candidates logged');
update orders set ready_at = now() - interval '2 minutes' where id = pg_temp.oid('10');
select pg_temp.adv('10');
select is((select count(*) from notifications where order_id = pg_temp.oid('10') and kind = 'no_rider_nearby'), 1::bigint,
  'after dispatch_notify_vendor_after_seconds the vendor is told (once)');
select pg_temp.adv('10');
select is((select count(*) from notifications where order_id = pg_temp.oid('10') and kind = 'no_rider_nearby'), 1::bigint, 'and not again');
select is((select state || '/' || attention_reason from order_dispatch where order_id = pg_temp.oid('10')), 'needs_attention/no_candidates',
  'order flagged needs_attention');
select is(pg_temp.ev('10', 'needs_attention'), 1::bigint, 'event needs_attention logged once');

-- ---------------------------------------------------------------------------
-- 8. Cycle exhaustion: expired riders are re-asked, declined ones never
-- ---------------------------------------------------------------------------

select pg_temp.only('r1', 'r2');
select pg_temp.mk_order('11');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
values (pg_temp.oid('11'), pg_temp.uid('r1'), 'offered', 1, 1, now() - interval '2 minutes', now() - interval '1 minute');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no)
values (pg_temp.oid('11'), pg_temp.uid('r2'), 'declined', 1, 2);
insert into res values ('o11', pg_temp.adv('11'));
select is((select v ->> 'outcome' || '/' || (v ->> 'cycle_no') || '/' || (v ->> 'attempt_no') from res where k = 'o11'), 'offered/2/3',
  'cycle 1 used up: a new cycle (2) starts and offers in the same call');
select is(pg_temp.live_rider('11'), pg_temp.uid('r1'), 'the expired rider r1 is asked again');
select is((select count(*) from dispatch_offers where order_id = pg_temp.oid('11') and rider_id = pg_temp.uid('r2') and cycle_no = 2), 0::bigint,
  'the declined rider r2 is never asked again');
select is(pg_temp.ev('11', 'cycle_started'), 1::bigint, 'event cycle_started logged for cycle 2');
select cmp_ok((select dispatch_cycle_started_at from orders where id = pg_temp.oid('11')), '>=', now(), 'orders.dispatch_cycle_started_at kept current');

-- ---------------------------------------------------------------------------
-- 9. Not dispatchable
-- ---------------------------------------------------------------------------

select pg_temp.only('r1');
select pg_temp.mk_order('12', 'accepted');
insert into res values ('o12', pg_temp.adv('12'));
select is((select v ->> 'outcome' || '/' || (v ->> 'reason') from res where k = 'o12'), 'not_dispatchable/not_due', 'accepted order before start_at: not due');
select is((select state from order_dispatch where order_id = pg_temp.oid('12')), 'scheduled', 'state scheduled');
select is((select next_check_at from order_dispatch where order_id = pg_temp.oid('12')), (select start_at from order_dispatch where order_id = pg_temp.oid('12')),
  'next_check_at = start_at');
select is(pg_temp.cnt('12'), 0::bigint, 'no offer before the window opens');
select is((select start_at from order_dispatch where order_id = pg_temp.oid('12')), now() + interval '1200 seconds' - interval '193 seconds' - interval '150 seconds',
  'start_at = accepted + 20 min prep - r1''s ETA (193 s) - 150 s buffer (0104: travel is the eligible riders'' ETA)');
update order_dispatch set start_at = now() - interval '1 second' where order_id = pg_temp.oid('12');
select is((pg_temp.adv('12') ->> 'outcome'), 'offered', 'once start_at has passed an accepted order is offered');

select pg_temp.only('r1');
select pg_temp.mk_order('13', 'ready_for_pickup', false, '411', '0', 'vendor');
select is((pg_temp.adv('13') ->> 'reason'), 'vendor_delivery', 'self-delivery order: not dispatchable');
select is((select state from order_dispatch where order_id = pg_temp.oid('13')), 'stopped', 'and stopped');

select pg_temp.only('r1', 'r2');
select pg_temp.mk_order('14');
select pg_temp.adv('14');
select is(pg_temp.cnt('14', 'offered'), 1::bigint, 'a live offer exists');
update orders set status = 'cancelled_by_platform' where id = pg_temp.oid('14');
select is((select status || '/' || close_reason from dispatch_offers where order_id = pg_temp.oid('14')), 'cancelled/order_cancelled',
  'cancelling the order closes the live offer (trigger)');
select is((select state || '/' || coalesce(next_check_at::text, 'null') from order_dispatch where order_id = pg_temp.oid('14')), 'stopped/null',
  'and stops dispatch');
select is((pg_temp.adv('14') ->> 'reason'), 'order_closed', 'the engine agrees');

select pg_temp.only('r1', 'r2');
select pg_temp.mk_order('15');
select pg_temp.adv('15');
update orders set rider_id = pg_temp.uid('r2') where id = pg_temp.oid('15');
select is((select state from order_dispatch where order_id = pg_temp.oid('15')), 'assigned', 'setting rider_id marks order_dispatch assigned');
select is((pg_temp.adv('15') ->> 'reason'), 'assigned', 'the engine reports the order as assigned');
select is((select status || '/' || close_reason from dispatch_offers where order_id = pg_temp.oid('15')),
  'superseded/order_assigned', 'a stray live offer on an assigned order is superseded by the engine');

-- ---------------------------------------------------------------------------
-- 10. Lifecycle triggers
-- ---------------------------------------------------------------------------

select pg_temp.only(variadic '{}'::text[]);   -- 0104: with no eligible rider the travel estimate is the 600 s default
select pg_temp.mk_order('16', 'placed');
update orders set status = 'accepted', accepted_at = now() where id = pg_temp.oid('16');
select is((select state from order_dispatch where order_id = pg_temp.oid('16')), 'scheduled', 'vendor accept creates order_dispatch (scheduled)');
select is((select expected_ready_at from order_dispatch where order_id = pg_temp.oid('16')), now() + interval '20 minutes', 'expected_ready_at = accepted + avg_prep');
select is((select start_at from order_dispatch where order_id = pg_temp.oid('16')), now() + interval '20 minutes' - interval '750 seconds',
  'start_at = expected ready - travel (600) - buffer (150)');
select is((select next_check_at from order_dispatch where order_id = pg_temp.oid('16')), now() + interval '60 seconds',
  'next_check_at = now + 60 s (0104: a scheduled order is re-looked at every minute, start_at is 7.5 min out)');
select is(pg_temp.ev('16', 'scheduled'), 1::bigint, 'event scheduled logged');

select pg_temp.mk_order('17', 'placed', false, '412');
update orders set status = 'accepted', accepted_at = now() where id = pg_temp.oid('17');
select is((select start_at from order_dispatch where order_id = pg_temp.oid('17')), now(), 'start_at is never before accepted_at (5 min prep)');

select pg_temp.only('r1');
select pg_temp.mk_order('18', 'preparing', false, '411', '1 minute');
update orders set status = 'ready_for_pickup', ready_at = now() where id = pg_temp.oid('18');
select is(pg_temp.live_rider('18'), pg_temp.uid('r1'), 'the ready trigger offers the nearest rider through the engine');
select ok((select first_dispatched_at is not null from orders where id = pg_temp.oid('18')), 'ready trigger stamps first_dispatched_at');

-- ---------------------------------------------------------------------------
-- 11. Wrappers
-- ---------------------------------------------------------------------------

select pg_temp.only('r1', 'r2');
select pg_temp.mk_order('19');
select is((select o_offers from _dispatch_offer_round(pg_temp.oid('19'), now())), 1, '_dispatch_offer_round: one offer');
select is((select o_offers from _dispatch_offer_round(pg_temp.oid('19'), now())), 0, '_dispatch_offer_round: none while a live offer exists');
select is(pg_temp.cnt('19'), 1::bigint, 'still one offer');
select is(_redispatch_core(pg_temp.oid('19'), true) ->> 'offers_created', '0', '_redispatch_core with a live offer: no double offer');
select ok((_redispatch_core(pg_temp.oid('19'), true)) ?& array['offers_created', 'riders_in_range', 'radius_m', 'tier'], '_redispatch_core keeps its jsonb shape');
select pg_temp.only('r1', 'r2');
select pg_temp.mk_order('20');
select is(_dispatch_offer_batch(pg_temp.oid('20'), now()), 1, '_dispatch_offer_batch returns 1 when it offered');
select is(_dispatch_offer_batch(pg_temp.oid('20'), now()), 0, '_dispatch_offer_batch returns 0 when waiting');

-- Sweep and early dispatch, as the cron runs them.
-- Early dispatch scans every scheduled order; park the earlier scenarios' ones.
update order_dispatch set state = 'stopped', next_check_at = null where state = 'scheduled';
select pg_temp.only('r1', 'r2');
select pg_temp.mk_order('21');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
values (pg_temp.oid('21'), pg_temp.uid('r1'), 'offered', 1, 1, now() - interval '2 minutes', now() - interval '1 minute');
select pg_temp.mk_order('22', 'accepted');
insert into order_dispatch (order_id, state, start_at, next_check_at) values (pg_temp.oid('22'), 'scheduled', now() - interval '1 minute', now() - interval '1 minute');

set local role service_role;
create temp table prep_res as select * from dispatch_orders_nearing_prep_completion();
reset role;
select is((select string_agg(attname, ',') from pg_attribute where attrelid = 'prep_res'::regclass and attnum > 0), 'offers_created',
  'dispatch_orders_nearing_prep_completion column unchanged');
select is((select offers_created from prep_res), 1, 'early dispatch offered the scheduled order whose start_at passed');
select is(pg_temp.live_rider('22'), pg_temp.uid('r1'), 'to the nearest rider');
set local role service_role;
create temp table sweep_res as select * from sweep_dispatch_offers();
reset role;
select is((select count(*) from sweep_res), 1::bigint, 'sweep_dispatch_offers returns one row');
select is((select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = 'sweep_res'::regclass and attnum > 0),
  'offers_expired,offers_created,orders_cancelled', 'sweep columns unchanged');
select cmp_ok((select offers_expired from sweep_res), '>=', 1, 'the sweep expired the lapsed offer');
select cmp_ok((select offers_created from sweep_res), '>=', 1, 'and offered the next rider');
select is((select status from dispatch_offers where order_id = pg_temp.oid('21') and rider_id = pg_temp.uid('r1')), 'expired', 'r1''s lapsed offer is expired');
select ok(exists (select 1 from dispatch_offers where order_id = pg_temp.oid('21') and status = 'offered' and rider_id = pg_temp.uid('r2')), 'r2 holds the new offer');
select is((select orders_cancelled from sweep_res), 0, 'nothing cancelled');

select ok(not has_function_privilege('authenticated', 'sweep_dispatch_offers()', 'execute'), 'sweep stays service-role only');

-- ---------------------------------------------------------------------------
-- 0108 parity: the inline SQL predicates in _dispatch_scan / _dispatch_candidates must stay
-- logically identical to the helpers (_dispatch_rider_available / _dispatch_rider_excluded) that
-- _dispatch_advance uses for its under-lock re-check. Mixed fixture, compared as sets.
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('de_pa' || n) from generate_series(1, 13) n;
insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
select tests.get_supabase_uid('de_pa' || n), true, 'approved', st_geogfromtext('POINT(' || (7.5 + 0.0007 * n) || ' 9.5)'), now()
from generate_series(1, 13) n;
update riders set is_online = false                       where user_id = pg_temp.uid('pa2');
update riders set kyc_status = 'pending'                  where user_id = pg_temp.uid('pa3');
update riders set last_ping_at = now() - interval '400 seconds' where user_id = pg_temp.uid('pa4');
update profiles set status = 'suspended'                  where id = pg_temp.uid('pa5');
update riders set current_location = null                 where user_id = pg_temp.uid('pa12');
select pg_temp.mk_order('90');
select pg_temp.mk_order('91', 'in_transit', false, '411', '0', 'rider', 'pa6');                     -- pa6: busy
select pg_temp.mk_order('92', 'delivered', false, '411', '0', 'rider', 'pa13');                     -- pa13: finished order, still free
select pg_temp.mk_order('93');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at) values
  (pg_temp.oid('93'), pg_temp.uid('pa7'), 'offered', 1, 1, now(), now() + interval '30 seconds'),                -- pa7: live offer elsewhere
  (pg_temp.oid('90'), pg_temp.uid('pa9'), 'declined', 1, 1, now(), now() + interval '1 minute'),                                        -- pa9: declined this order
  (pg_temp.oid('90'), pg_temp.uid('pa10'), 'expired', 2, 2, now() - interval '2 minutes', now() - interval '1 minute'),  -- pa10: asked in THIS cycle
  (pg_temp.oid('90'), pg_temp.uid('pa11'), 'expired', 1, 3, now() - interval '2 minutes', now() - interval '1 minute');  -- pa11: asked in an older cycle only
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
values (pg_temp.oid('92'), pg_temp.uid('pa8'), 'offered', 1, 1, now() - interval '2 minutes', now() - interval '1 minute');  -- pa8: lapsed offer elsewhere (not live)

create temp table par_helper as
select r.user_id as uid from riders r
where _dispatch_rider_available(r.user_id) and not _dispatch_rider_excluded(pg_temp.oid('90'), r.user_id, 2);
create temp table par_knn as
select c.rider_id as uid from _dispatch_candidates(pg_temp.oid('90'), null, null, 2, 100000) c;
create temp table par_ring as
select c.rider_id as uid from _dispatch_candidates(pg_temp.oid('90'), 8, null, 2, 100000) c;

select cmp_ok((select count(*) from par_helper), '>=', 4::bigint, 'parity fixture: the helpers accept a healthy set of riders');
select ok(exists (select 1 from par_helper where uid = pg_temp.uid('pa1')) and exists (select 1 from par_helper where uid = pg_temp.uid('pa11'))
          and exists (select 1 from par_helper where uid = pg_temp.uid('pa13')) and exists (select 1 from par_helper where uid = pg_temp.uid('pa8')),
  'helpers accept healthy, older-cycle, finished-order and lapsed-offer riders');
select ok(not exists (select 1 from par_helper where uid in (select pg_temp.uid('pa' || n) from unnest(array[2, 3, 4, 5, 6, 7, 9, 10, 12]) n)),
  'helpers reject offline, unapproved, stale, suspended, busy, live-elsewhere, declined, this-cycle and no-location riders');
select is((select coalesce(array_agg(uid order by uid), '{}') from (select uid from par_helper except select uid from par_knn) q), '{}'::uuid[],
  'KNN scan: every helper-accepted rider is a candidate');
select is((select coalesce(array_agg(uid order by uid), '{}') from (select uid from par_knn except select uid from par_helper) q), '{}'::uuid[],
  'KNN scan: no candidate the helpers would reject');
select is((select coalesce(array_agg(uid order by uid), '{}') from (
             select uid from par_helper h where exists (select 1 from riders r where r.user_id = h.uid and r.h3_cell is not null
               and exists (select 1 from h3_grid_disk_distances(h3_latlng_to_cell(9.5, 7.5, 8), 8) d
                           cross join lateral h3_cell_to_descendant_range(d.cell, 9) g where r.h3_cell between g.lo and g.hi))
             except select uid from par_ring) q), '{}'::uuid[],
  'ring scan: every helper-accepted rider inside the disk is a candidate');
select is((select coalesce(array_agg(uid order by uid), '{}') from (select uid from par_ring except select uid from par_helper) q), '{}'::uuid[],
  'ring scan: no candidate the helpers would reject');
select cmp_ok((select count(*) from par_ring), '>=', 4::bigint, 'ring scan returns the fixture riders');
-- ranking: same order and ETA as the single ETA seam would give (ETA monotonic in distance)
select is((select array_agg(rider_id order by o) from (select rider_id, row_number() over () o from _dispatch_candidates(pg_temp.oid('90'), 8, null, 2, 100000)) q),
          (select array_agg(rider_id order by eta_seconds, distance_m, rider_id) from _dispatch_candidates(pg_temp.oid('90'), 8, null, 2, 100000)),
  'candidates come back ordered by (eta, distance, rider)');
select ok(not has_function_privilege('authenticated', '_dispatch_scan(uuid, integer, integer, integer, integer, integer)', 'execute')
      and not has_function_privilege('service_role', '_dispatch_scan(uuid, integer, integer, integer, integer, integer)', 'execute'),
  '_dispatch_scan is internal');

select * from finish();
rollback;
