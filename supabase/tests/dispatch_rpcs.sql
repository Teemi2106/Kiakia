-- pgTAP: the dispatch RPCs on the sequential engine (0102): the shared
-- accept/decline core, the legacy rider RPCs (names, return types and error
-- substrings the rider app maps), respond_to_dispatch_offer, get_dispatch_offer,
-- the rate limit, admin reassign / settings / status / history, and the vendor view.
--
-- What this protects:
-- (1) ONE winner. Accept re-validates everything in the transaction; a loser (taken,
--     expired, withdrawn, declined, ineligible) changes nothing and gets a
--     deterministic outcome; the same rider repeating an accept gets success.
-- (2) A decline asks the next rider in the same transaction.
-- (3) The rider app's error substrings survive on the legacy RPCs.
-- (4) PRIVACY: an offer id of another rider answers like a missing one; the
--     customer's phone exists only for the rider who holds the order (0072).
-- (5) 30 responses per rider per rolling minute, SQLSTATE P0429 'rate_limited:'.
-- (6) An admin assignment keeps exactly one accepted offer; settings enforce the
--     ring rule; status and history expose the engine state.
--
-- Geometry as in dispatch_engine.sql: the vendor sits at POINT(7.5 9.5); rider
-- number n sits n x 0.001 degrees (about 110 m x n) east of it, so every rider is
-- within 2.7 km and a big order funds any of them. 'far' is ~6.6 km away.

begin;
select plan(180);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('dr_customer');
select tests.create_supabase_user('dr_vendor');
select tests.create_supabase_user('dr_admin');
select tests.create_supabase_user('dr_' || lpad(n::text, 2, '0')) from generate_series(1, 26) n;
select tests.create_supabase_user('dr_' || n) from unnest(array['kyc', 'busy', 'stale', 'far']) n;

insert into user_roles (user_id, role) values (tests.get_supabase_uid('dr_admin'), 'admin');
update profiles set full_name = 'Cust Name', phone = '+2348012345678' where id = tests.get_supabase_uid('dr_customer');
update profiles set full_name = 'Rider Twentyfour' where id = tests.get_supabase_uid('dr_24');

insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
values ('ee000000-0000-7000-8000-000000000501', 'DR Area',
        st_geogfromtext('POLYGON((7.0 9.0, 8.5 9.0, 8.5 10.0, 7.0 10.0, 7.0 9.0))'), true, 50000, 15000, 50000, 15000);

insert into vendors (id, owner_user_id, name, slug, status, location, commission_bps, delivery_radius_m, avg_prep_mins) values
  ('ee000000-0000-7000-8000-000000000511', tests.get_supabase_uid('dr_vendor'), 'DR V1', 'dr-v1', 'active', st_geogfromtext('POINT(7.5 9.5)'), 1500, 20000, 20);
insert into vendor_staff (vendor_id, user_id, role)
values ('ee000000-0000-7000-8000-000000000511', tests.get_supabase_uid('dr_vendor'), 'vendor_owner')
on conflict do nothing;

insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
select tests.get_supabase_uid('dr_' || lpad(n::text, 2, '0')), true, 'approved', st_geogfromtext('POINT(' || (7.5 + n * 0.001) || ' 9.5)'), now()
from generate_series(1, 26) n;
insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
select tests.get_supabase_uid('dr_' || n), true, k, st_geogfromtext('POINT(' || (7.5 + dx) || ' 9.5)'), now() - ago
from (values ('kyc', 'pending', 0.0055, interval '0'), ('busy', 'approved', 0.0065, interval '0'),
             ('stale', 'approved', 0.0075, interval '10 minutes'), ('far', 'approved', 0.06, interval '0')) as t(n, k, dx, ago);

create function pg_temp.u(p int) returns uuid language sql as $$ select tests.get_supabase_uid('dr_' || lpad(p::text, 2, '0')) $$;
create function pg_temp.s(p text) returns uuid language sql as $$ select tests.get_supabase_uid('dr_' || p) $$;
create function pg_temp.oid(p_n text) returns uuid language sql as $$ select ('ee000000-0000-7000-8000-0000000005' || p_n)::uuid $$;

create function pg_temp.mk_order(p_n text, p_status order_status default 'ready_for_pickup', p_small boolean default false,
                                 p_ready_ago interval default '0', p_rider uuid default null)
returns void language sql as $$
  insert into orders (id, customer_id, vendor_id, service_area_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo,
                      discount_kobo, total_kobo, delivery_address, delivery_location, rider_id, ready_at, accepted_at, first_dispatched_at, delivery_by)
  values (pg_temp.oid(p_n), tests.get_supabase_uid('dr_customer'), 'ee000000-0000-7000-8000-000000000511',
          'ee000000-0000-7000-8000-000000000501', p_status, 'paid',
          case when p_small then 100000 else 5000000 end, 50000, case when p_small then 10000 else 100000 end, 0,
          case when p_small then 160000 else 5150000 end,
          '{"line1": "1 DR Street"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'), p_rider,
          case when p_status = 'ready_for_pickup' then now() - p_ready_ago end,
          now() - p_ready_ago,
          case when p_status = 'ready_for_pickup' then now() - p_ready_ago end,
          'rider');
$$;

-- Only the named riders are online (and freshly pinged).
create function pg_temp.only(variadic p_uids uuid[]) returns void language sql as $$
  update riders set is_online = user_id = any(p_uids),
                    last_ping_at = case when user_id = tests.get_supabase_uid('dr_stale') then last_ping_at else now() end;
$$;
create function pg_temp.adv(p_n text) returns jsonb language sql as $$ select _dispatch_advance(pg_temp.oid(p_n), 'test', false) $$;
create function pg_temp.live_rider(p_n text) returns uuid language sql as $$
  select rider_id from dispatch_offers where order_id = pg_temp.oid(p_n) and status = 'offered' $$;
create function pg_temp.cnt(p_n text, p_status text default null) returns bigint language sql as $$
  select count(*) from dispatch_offers where order_id = pg_temp.oid(p_n) and (p_status is null or status = p_status) $$;
create function pg_temp.ev(p_n text, p_event text) returns bigint language sql as $$
  select count(*) from dispatch_events where order_id = pg_temp.oid(p_n) and event = p_event $$;
create function pg_temp.st(p_n text, p_rider uuid) returns text language sql as $$
  select status || '/' || coalesce(close_reason, '-') from dispatch_offers
  where order_id = pg_temp.oid(p_n) and rider_id = p_rider order by attempt_no desc limit 1 $$;

create temp table res (k text primary key, v jsonb);
create temp table ids (k text primary key, v uuid);
grant all on res, ids to public;
-- the latest offer of rider p on order n
create function pg_temp.keep(p_k text, p_n text, p_rider uuid) returns void language sql as $$
  insert into ids select p_k, id from dispatch_offers where order_id = pg_temp.oid(p_n) and rider_id = p_rider order by attempt_no desc limit 1 $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

select ok(has_function_privilege('authenticated', f.sig, 'execute') and not has_function_privilege('anon', f.sig, 'execute'),
  format('%s: authenticated yes, anon no', f.sig))
from (values ('respond_to_dispatch_offer(uuid, text)'), ('get_dispatch_offer(uuid)')) as f(sig);
select ok(has_function_privilege('service_role', 'admin_dispatch_order_history(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'admin_dispatch_order_history(uuid)', 'execute'),
  'admin_dispatch_order_history: service_role only');
select ok(not has_function_privilege(r.role, f.sig, 'execute'), format('%s cannot execute internal %s', r.role, f.sig))
from (values ('_dispatch_respond(uuid, uuid, text)'), ('_dispatch_rate_check(uuid)'), ('_redispatch_core(uuid, boolean, text)'),
             ('_rider_offer_detail_json(orders, uuid)')) as f(sig)
cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role);
select ok(not has_table_privilege('authenticated', 'rider_offer_responses', 'select'), 'the rate-limit log is not readable by clients');

-- ---------------------------------------------------------------------------
-- 1. Accept, ready path (respond_to_dispatch_offer); same rider again
-- ---------------------------------------------------------------------------

select pg_temp.only(pg_temp.u(1), pg_temp.u(2));
select pg_temp.mk_order('01');
select pg_temp.adv('01');
select is(pg_temp.live_rider('01'), pg_temp.u(1), 'r01 holds the live offer on order 01');
select pg_temp.keep('o01', '01', pg_temp.u(1));

select tests.authenticate_as('dr_01');
insert into res select 's1', respond_to_dispatch_offer((select v from ids where k = 'o01'), 'accept');
insert into res select 's1b', respond_to_dispatch_offer((select v from ids where k = 'o01'), 'accept');
insert into res select 's1c', to_jsonb(a) from accept_dispatch_offer(pg_temp.oid('01')) a;
reset role;

select is((select v ->> 'outcome' from res where k = 's1'), 'accepted', 'respond accept: accepted');
select is((select v ->> 'status' from res where k = 's1'), 'accepted', '... offer status accepted');
select is((select v ->> 'order_status' from res where k = 's1'), 'rider_assigned', '... order moved to rider_assigned (ready path)');
select is((select rider_id from orders where id = pg_temp.oid('01')), pg_temp.u(1), 'orders.rider_id is r01');
select ok((select rider_fee_kobo > 0 and assigned_at is not null from orders where id = pg_temp.oid('01')), 'fee frozen and assigned_at stamped');
select is(pg_temp.cnt('01', 'accepted'), 1::bigint, 'exactly one accepted offer');
select is(pg_temp.cnt('01', 'offered'), 0::bigint, 'no live offer remains');
select is((select count(*) from order_events where order_id = pg_temp.oid('01') and from_status = 'ready_for_pickup' and to_status = 'rider_assigned' and actor_id = pg_temp.u(1)),
  1::bigint, 'one ready -> rider_assigned order_events row');
select is((select state from order_dispatch where order_id = pg_temp.oid('01')), 'assigned', 'order_dispatch: assigned');
select ok((select assigned_eta_at > now() from order_dispatch where order_id = pg_temp.oid('01')), 'initial pickup ETA stamped');
select is(pg_temp.ev('01', 'offer_accepted'), 1::bigint, 'event offer_accepted logged');
select is((select v ->> 'outcome' from res where k = 's1b'), 'already_yours', 'same rider accepting again: already_yours');
select is((select v ->> 'rider_id' from res where k = 's1c'), pg_temp.u(1)::text, 'legacy accept by the holder returns the orders row (idempotent)');
select is(pg_temp.cnt('01'), 1::bigint, 'replays created no second offer');
select is((select count(*) from order_events where order_id = pg_temp.oid('01') and to_status = 'rider_assigned'), 1::bigint, 'replays wrote no second order_events row');

-- ---------------------------------------------------------------------------
-- 2. Accept, early path (legacy accept_dispatch_offer)
-- ---------------------------------------------------------------------------

select pg_temp.only(pg_temp.u(3));
-- 0104: start_at = ready - the rider's ETA - buffer, so the order must be well into its prep for the rider to be due now
select pg_temp.mk_order('02', 'preparing', false, interval '18 minutes');
select pg_temp.adv('02');
select is(pg_temp.live_rider('02'), pg_temp.u(3), 'early dispatch offered order 02 to r03');

select tests.authenticate_as('dr_03');
insert into res select 's2', to_jsonb(a) from accept_dispatch_offer(pg_temp.oid('02')) a;
reset role;
select is((select v ->> 'status' from res where k = 's2'), 'preparing', 'early accept: status unchanged (preparing)');
select is((select v ->> 'rider_id' from res where k = 's2'), pg_temp.u(3)::text, 'early accept: rider_id set');
select ok((select rider_fee_kobo > 0 and assigned_at is null from orders where id = pg_temp.oid('02')), 'early accept: fee frozen, assigned_at untouched');
select is((select count(*) from order_events where order_id = pg_temp.oid('02') and meta ->> 'early_accept' = 'true'), 1::bigint, 'early_accept order_events row');
select is(pg_temp.st('02', pg_temp.u(3)), 'accepted/-', 'offer accepted');

-- ---------------------------------------------------------------------------
-- 3. Not this rider's offer / no offer at all
-- ---------------------------------------------------------------------------

select pg_temp.only(pg_temp.u(4), pg_temp.u(5));
select pg_temp.mk_order('03');
select pg_temp.adv('03');
select pg_temp.keep('o03', '03', pg_temp.u(4));

select tests.authenticate_as('dr_05');
insert into res select 's3', respond_to_dispatch_offer((select v from ids where k = 'o03'), 'accept');
insert into res select 's3b', respond_to_dispatch_offer(gen_random_uuid(), 'decline');
select throws_like(format($$ select accept_dispatch_offer(%L::uuid) $$, pg_temp.oid('03')), '%no active offer for this rider%', 'legacy accept without an offer: no active offer');
select throws_like(format($$ select decline_dispatch_offer(%L::uuid) $$, pg_temp.oid('03')), '%no active offer for this rider%', 'legacy decline without an offer: no active offer');
select throws_like(format($$ select accept_dispatch_offer(%L::uuid) $$, gen_random_uuid()), '%does not exist%', 'legacy accept on a missing order: does not exist');
select throws_ok(format($$ select respond_to_dispatch_offer(%L::uuid, 'maybe') $$, (select v from ids where k = 'o03')), '23514', null, 'respond with an invalid action raises check_violation');
reset role;
select is((select v ->> 'outcome' from res where k = 's3'), 'not_found', 'another rider''s offer id: not_found');
select is((select v ->> 'order_id' from res where k = 's3'), null, '... and it does not reveal the order');
select is((select v ->> 'outcome' from res where k = 's3b'), 'not_found', 'a random offer id: the same not_found');
select is(pg_temp.live_rider('03'), pg_temp.u(4), 'the offer of r04 is untouched');

-- ---------------------------------------------------------------------------
-- 4. Expiry: refused, the offer closed, the next rider asked
-- ---------------------------------------------------------------------------

select pg_temp.only(pg_temp.u(6), pg_temp.u(7));
select pg_temp.mk_order('04');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
values (pg_temp.oid('04'), pg_temp.u(6), 'offered', 1, 1, now() - interval '2 minutes', now() - interval '1 minute');
select pg_temp.keep('o04', '04', pg_temp.u(6));

select tests.authenticate_as('dr_06');
select throws_like(format($$ select accept_dispatch_offer(%L::uuid) $$, pg_temp.oid('04')), '%offer has expired%', 'legacy accept after expiry: offer has expired');
reset role;
select is(pg_temp.st('04', pg_temp.u(6)), 'offered/-', 'legacy raise rolled the close back (the tick does it)');
select tests.authenticate_as('dr_06');
insert into res select 's4', respond_to_dispatch_offer((select v from ids where k = 'o04'), 'accept');
insert into res select 's4b', respond_to_dispatch_offer((select v from ids where k = 'o04'), 'accept');
reset role;
select is((select v ->> 'outcome' from res where k = 's4'), 'expired', 'respond accept after expiry: expired');
select is(pg_temp.st('04', pg_temp.u(6)), 'expired/timeout', 'the offer is closed as expired (timeout)');
select is(pg_temp.live_rider('04'), pg_temp.u(7), 'the next rider (r07) was asked immediately');
select is((select v ->> 'next' from res where k = 's4'), 'offered', 'outcome reports the engine result');
select is((select v ->> 'outcome' from res where k = 's4b'), 'expired', 'repeating it: expired again, no further change');
select is(pg_temp.cnt('04'), 2::bigint, 'exactly two offers on order 04');
select is(pg_temp.ev('04', 'stale_accept_rejected'), 1::bigint, 'stale_accept_rejected logged once');
select is(pg_temp.ev('04', 'offer_created'), 1::bigint, 'offer_created logged for the follow-up offer');

-- ---------------------------------------------------------------------------
-- 5. Decline: next rider immediately; repeat; late accept
-- ---------------------------------------------------------------------------

select pg_temp.only(pg_temp.u(8), pg_temp.u(9), pg_temp.u(10));
select pg_temp.mk_order('05');
select pg_temp.adv('05');
select is(pg_temp.live_rider('05'), pg_temp.u(8), 'r08 is asked first');
select pg_temp.keep('o05', '05', pg_temp.u(8));

select tests.authenticate_as('dr_08');
insert into res select 's5', to_jsonb(d) from decline_dispatch_offer(pg_temp.oid('05')) d;
insert into res select 's5b', to_jsonb(d) from decline_dispatch_offer(pg_temp.oid('05')) d;
insert into res select 's5c', respond_to_dispatch_offer((select v from ids where k = 'o05'), 'decline');
insert into res select 's5d', respond_to_dispatch_offer((select v from ids where k = 'o05'), 'accept');
select throws_like(format($$ select accept_dispatch_offer(%L::uuid) $$, pg_temp.oid('05')), '%no active offer for this rider%', 'legacy accept after declining: no active offer');
reset role;
select is((select v ->> 'status' from res where k = 's5'), 'declined', 'legacy decline returns the closed row');
select is((select v ->> 'id' from res where k = 's5b'), (select v ->> 'id' from res where k = 's5'), 'a repeated decline returns the same closed row');
select is((select v ->> 'outcome' from res where k = 's5c'), 'declined', 'respond decline again: declined');
select is((select v ->> 'outcome' from res where k = 's5d'), 'declined', 'respond accept on a declined offer: declined');
select is(pg_temp.st('05', pg_temp.u(8)), 'declined/rider_declined', 'offer closed with rider_declined');
select is(pg_temp.live_rider('05'), pg_temp.u(9), 'the decline asked r09 in the same transaction (no wait)');
select is((select attempt_no from dispatch_offers where order_id = pg_temp.oid('05') and status = 'offered'), 2, 'attempt 2');
select is(pg_temp.ev('05', 'offer_declined'), 1::bigint, 'one offer_declined event (the repeats added none)');

select tests.authenticate_as('dr_09');
insert into res select 's5e', to_jsonb(a) from accept_dispatch_offer(pg_temp.oid('05')) a;
reset role;
select is((select v ->> 'rider_id' from res where k = 's5e'), pg_temp.u(9)::text, 'r09 accepted');

select tests.authenticate_as('dr_08');
select throws_like(format($$ select accept_dispatch_offer(%L::uuid) $$, pg_temp.oid('05')), '%already assigned or not ready for pickup%', 'a loser''s legacy accept: already assigned');
insert into res select 's5f', respond_to_dispatch_offer((select v from ids where k = 'o05'), 'accept');
reset role;
select is((select v ->> 'outcome' from res where k = 's5f'), 'taken', 'a loser''s respond accept: taken');
select is((select rider_id from orders where id = pg_temp.oid('05')), pg_temp.u(9), 'the winner keeps the order');
select is(pg_temp.ev('05', 'accept_conflict'), 1::bigint, 'accept_conflict logged for the respond loser');

-- Decline of a live offer whose clock already ran out is still allowed.
select pg_temp.only(pg_temp.u(11), pg_temp.u(12));
select pg_temp.mk_order('06');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
values (pg_temp.oid('06'), pg_temp.u(11), 'offered', 1, 1, now() - interval '2 minutes', now() - interval '1 minute');
select tests.authenticate_as('dr_11');
select lives_ok(format($$ select decline_dispatch_offer(%L::uuid) $$, pg_temp.oid('06')), 'declining an expired-by-clock live offer is allowed');
reset role;
select is(pg_temp.st('06', pg_temp.u(11)), 'declined/rider_declined', '... and it is a decline');
select is(pg_temp.live_rider('06'), pg_temp.u(12), '... and r12 is asked next');

-- ---------------------------------------------------------------------------
-- 6. Ineligible at accept time (state untouched, legacy messages kept)
-- ---------------------------------------------------------------------------

select pg_temp.only(pg_temp.s('kyc'), pg_temp.s('busy'), pg_temp.s('stale'), pg_temp.s('far'));
select pg_temp.mk_order('17', 'rider_assigned', false, interval '0', pg_temp.s('busy'));   -- busy on 17
select pg_temp.mk_order('07');
select pg_temp.mk_order('08');
select pg_temp.mk_order('09');
select pg_temp.mk_order('10', 'ready_for_pickup', true);                                       -- small: far is unfundable
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no) values
  (pg_temp.oid('07'), pg_temp.s('kyc'), 'offered', 1, 1),
  (pg_temp.oid('08'), pg_temp.s('busy'), 'offered', 1, 1),
  (pg_temp.oid('09'), pg_temp.s('stale'), 'offered', 1, 1),
  (pg_temp.oid('10'), pg_temp.s('far'), 'offered', 1, 1);
select pg_temp.keep('o07', '07', pg_temp.s('kyc'));
select pg_temp.keep('o08', '08', pg_temp.s('busy'));
select pg_temp.keep('o09', '09', pg_temp.s('stale'));
select pg_temp.keep('o10', '10', pg_temp.s('far'));

select tests.authenticate_as('dr_kyc');
insert into res select 's6a', respond_to_dispatch_offer((select v from ids where k = 'o07'), 'accept');
select throws_like(format($$ select accept_dispatch_offer(%L::uuid) $$, pg_temp.oid('07')), '%rider is not kyc-approved%', 'legacy: not kyc-approved');
reset role;
select tests.authenticate_as('dr_busy');
insert into res select 's6b', respond_to_dispatch_offer((select v from ids where k = 'o08'), 'accept');
select throws_like(format($$ select accept_dispatch_offer(%L::uuid) $$, pg_temp.oid('08')), '%rider already has an active order%', 'legacy: already has an active order');
reset role;
select tests.authenticate_as('dr_stale');
insert into res select 's6c', respond_to_dispatch_offer((select v from ids where k = 'o09'), 'accept');
select throws_like(format($$ select accept_dispatch_offer(%L::uuid) $$, pg_temp.oid('09')), '%must be online with a location update%', 'legacy: must be online with a location update');
reset role;
select tests.authenticate_as('dr_far');
insert into res select 's6d', respond_to_dispatch_offer((select v from ids where k = 'o10'), 'accept');
select throws_like(format($$ select accept_dispatch_offer(%L::uuid) $$, pg_temp.oid('10')), '%is too far from this rider%', 'legacy: too far from this rider');
reset role;

select is((select v ->> 'outcome' || '/' || (v ->> 'reason') from res where k = 's6a'), 'ineligible/kyc', 'respond: ineligible (kyc)');
select is((select v ->> 'outcome' || '/' || (v ->> 'reason') from res where k = 's6b'), 'ineligible/busy', 'respond: ineligible (busy)');
select is((select v ->> 'outcome' || '/' || (v ->> 'reason') from res where k = 's6c'), 'ineligible/location', 'respond: ineligible (location)');
select is((select v ->> 'outcome' || '/' || (v ->> 'reason') from res where k = 's6d'), 'ineligible/unfundable', 'respond: ineligible (unfundable)');
select is((select count(*) from dispatch_offers where order_id = any(array[pg_temp.oid('07'), pg_temp.oid('08'), pg_temp.oid('09'), pg_temp.oid('10')]) and status = 'offered'),
  4::bigint, 'no ineligible accept changed an offer');
select is((select count(*) from orders where id = any(array[pg_temp.oid('07'), pg_temp.oid('08'), pg_temp.oid('09'), pg_temp.oid('10')]) and rider_id is not null),
  0::bigint, 'no ineligible accept assigned an order');

-- ---------------------------------------------------------------------------
-- 7. get_dispatch_offer: own vs other, privacy
-- ---------------------------------------------------------------------------

select pg_temp.only(pg_temp.u(13), pg_temp.u(14));
select pg_temp.mk_order('11');
select pg_temp.adv('11');
select pg_temp.keep('o11', '11', pg_temp.u(13));

select tests.authenticate_as('dr_13');
insert into res select 'g1', get_dispatch_offer((select v from ids where k = 'o11'));
reset role;
select tests.authenticate_as('dr_14');
insert into res select 'g2', get_dispatch_offer((select v from ids where k = 'o11'));
reset role;
select is((select v ->> 'status' from res where k = 'g1'), 'offered', 'own offer: status offered');
select ok((select (v ->> 'actionable')::boolean and (v ->> 'seconds_left')::int between 1 and 45 from res where k = 'g1'), 'own offer: actionable, seconds_left from the server clock');
select is((select v #>> '{order,vendor_name}' from res where k = 'g1'), 'DR V1', 'own live offer: vendor details present');
select ok((select v #> '{order,customer_phone}' = 'null'::jsonb and v #> '{order,customer_name}' = 'null'::jsonb from res where k = 'g1'),
  'PRIVACY: no customer name or phone before accept');
select ok((select v::text !~ '2348012345678' from res where k = 'g1'), 'PRIVACY: the customer phone appears nowhere in the payload');
select is((select v ->> 'status' from res where k = 'g2'), null, 'another rider''s offer id: not_found shape (no status)');
select ok((select v ->> 'outcome' = 'not_found' and v ->> 'order_id' is null and v -> 'order' = 'null'::jsonb and not (v ->> 'actionable')::boolean from res where k = 'g2'),
  '... no order id, no details, not actionable');

select tests.authenticate_as('dr_13');
insert into res select 's7', respond_to_dispatch_offer((select v from ids where k = 'o11'), 'accept');
insert into res select 'g3', get_dispatch_offer((select v from ids where k = 'o11'));
reset role;
select ok((select v ->> 'status' = 'accepted' and not (v ->> 'actionable')::boolean and (v ->> 'holds_order')::boolean from res where k = 'g3'), 'after accept: accepted, not actionable, holds_order');
select is((select v #>> '{order,customer_phone}' from res where k = 'g3'), '+2348012345678', 'the holder sees the customer phone (0072)');

select tests.authenticate_as('dr_14');
insert into res select 'g4', get_dispatch_offer((select v from ids where k = 'o05'));
reset role;
select is((select v ->> 'outcome' from res where k = 'g4'), 'not_found', 'an offer of a settled order of another rider: not_found');
select tests.authenticate_as('dr_08');
insert into res select 'g5', get_dispatch_offer((select v from ids where k = 'o05'));
reset role;
select ok((select v ->> 'status' = 'declined' and v -> 'order' = 'null'::jsonb and v ->> 'actionable' = 'false' from res where k = 'g5'),
  'a closed own offer: status, no order details, not actionable');

-- ---------------------------------------------------------------------------
-- 8. Taken because an admin assigned someone else; admin reassign keeps ONE accepted offer
-- ---------------------------------------------------------------------------

select pg_temp.only(pg_temp.u(15), pg_temp.u(16), pg_temp.u(17), pg_temp.u(18));
select pg_temp.mk_order('12');
select pg_temp.adv('12');
select is(pg_temp.live_rider('12'), pg_temp.u(15), 'r15 holds the live offer on order 12');
select pg_temp.keep('o12', '12', pg_temp.u(15));

select tests.authenticate_as_service_role();
select throws_ok(format($$ select admin_reassign_order_rider(%L::uuid, %L::uuid, 'x', %L::uuid) $$, pg_temp.oid('12'), pg_temp.u(16), pg_temp.s('customer')),
  'P0001', null, 'a non-admin actor is still refused');
insert into res select 'a1', to_jsonb(r) from admin_reassign_order_rider(pg_temp.oid('12'), pg_temp.u(16), 'support call', pg_temp.s('admin')) r;
reset role;
select is((select v ->> 'rider_id' from res where k = 'a1'), pg_temp.u(16)::text, 'admin assign: order now r16''s');
select is(pg_temp.st('12', pg_temp.u(15)), 'superseded/admin_assigned', 'the live offer was superseded (admin_assigned)');
select is(pg_temp.cnt('12', 'accepted'), 1::bigint, 'exactly one accepted offer');
select is((select cycle_no || '/' || attempt_no from dispatch_offers where order_id = pg_temp.oid('12') and status = 'accepted'), '1/2',
  'the new accepted offer is numbered (current cycle, next attempt)');
select is((select state || '/' || attempt_no from order_dispatch where order_id = pg_temp.oid('12')), 'assigned/2', 'order_dispatch follows');

select tests.authenticate_as('dr_15');
insert into res select 's8', respond_to_dispatch_offer((select v from ids where k = 'o12'), 'accept');
select throws_like(format($$ select accept_dispatch_offer(%L::uuid) $$, pg_temp.oid('12')), '%already assigned or not ready for pickup%', 'the superseded rider: already assigned (legacy)');
reset role;
select is((select v ->> 'outcome' from res where k = 's8'), 'taken', 'the superseded rider: taken');

select tests.authenticate_as_service_role();
insert into res select 'a2', to_jsonb(r) from admin_reassign_order_rider(pg_temp.oid('12'), pg_temp.u(17), 'wrong rider', pg_temp.s('admin')) r;
reset role;
select is(pg_temp.st('12', pg_temp.u(16)), 'revoked/admin_reassigned', 'reassign: the previous accepted offer is revoked');
select is(pg_temp.cnt('12', 'accepted'), 1::bigint, 'still exactly one accepted offer');
select is((select rider_id from dispatch_offers where order_id = pg_temp.oid('12') and status = 'accepted'), pg_temp.u(17), '... for the new rider');
select is((select attempt_no from dispatch_offers where order_id = pg_temp.oid('12') and status = 'accepted'), 3, 'attempt 3');

select tests.authenticate_as_service_role();
insert into res select 'a3', to_jsonb(r) from admin_reassign_order_rider(pg_temp.oid('12'), null, 'rider stopped answering', pg_temp.s('admin')) r;
reset role;
select is((select v ->> 'status' from res where k = 'a3'), 'ready_for_pickup', 'unassign from rider_assigned: back to ready_for_pickup');
select is((select v ->> 'rider_id' from res where k = 'a3'), null, '... no rider');
select is(pg_temp.st('12', pg_temp.u(17)), 'revoked/admin_reassigned', 'unassign: the accepted offer is revoked');
select is(pg_temp.cnt('12', 'accepted'), 0::bigint, 'no accepted offer left');
select is(pg_temp.cnt('12', 'offered'), 1::bigint, 'exactly one live offer after the re-offer');
select ok(pg_temp.live_rider('12') not in (pg_temp.u(16), pg_temp.u(17)), 'revoked riders are never re-offered');
select ok((select count(*) from dispatch_offers where order_id = pg_temp.oid('12') group by cycle_no, attempt_no order by 1 desc limit 1) = 1,
  'no (cycle, attempt) is used twice');

-- an early (not yet ready) order: assign, then unassign re-offers right away
select pg_temp.only(pg_temp.u(19), pg_temp.u(20), pg_temp.u(21));
select pg_temp.mk_order('14', 'preparing', false, interval '0');
select is((pg_temp.adv('14') ->> 'outcome'), 'not_dispatchable', 'order 14 is scheduled: dispatch has not started');
select tests.authenticate_as_service_role();
select lives_ok(format($$ select admin_reassign_order_rider(%L::uuid, %L::uuid, 'vip', %L::uuid) $$, pg_temp.oid('14'), pg_temp.u(19), pg_temp.s('admin')), 'assign on a preparing order');
select lives_ok(format($$ select admin_reassign_order_rider(%L::uuid, null, 'vip cancelled', %L::uuid) $$, pg_temp.oid('14'), pg_temp.s('admin')), 'unassign on a preparing order');
reset role;
select is((select status::text || '/' || coalesce(rider_id::text, '-') from orders where id = pg_temp.oid('14')), 'preparing/-', 'still preparing, no rider');
select is(pg_temp.st('14', pg_temp.u(19)), 'revoked/admin_reassigned', 'r19 revoked');
select ok(pg_temp.live_rider('14') in (pg_temp.u(20), pg_temp.u(21)), 'an admin re-offer starts the search now (start pulled forward)');

-- ---------------------------------------------------------------------------
-- 9. Rate limit
-- ---------------------------------------------------------------------------

select tests.authenticate_as('dr_22');
select lives_ok($$ select respond_to_dispatch_offer(gen_random_uuid(), 'accept') from generate_series(1, 30) $$, '30 responses in a minute are fine');
select throws_ok($$ select respond_to_dispatch_offer(gen_random_uuid(), 'accept') $$, 'P0429', null, 'the 31st is rate limited (respond)');
select throws_like($$ select respond_to_dispatch_offer(gen_random_uuid(), 'decline') $$, 'rate_limited:%', 'message starts with rate_limited:');
select throws_ok(format($$ select accept_dispatch_offer(%L::uuid) $$, pg_temp.oid('03')), 'P0429', null, 'legacy accept shares the same limit');
select throws_ok(format($$ select decline_dispatch_offer(%L::uuid) $$, pg_temp.oid('03')), 'P0429', null, 'legacy decline shares the same limit');
reset role;
select tests.authenticate_as('dr_23');
select lives_ok($$ select respond_to_dispatch_offer(gen_random_uuid(), 'accept') $$, 'another rider is not affected');
reset role;
select is((select count(*) from rider_offer_responses where rider_id = pg_temp.u(22)), 30::bigint, 'the log holds exactly the 30 counted calls');
update rider_offer_responses set at = at - interval '2 minutes' where rider_id = pg_temp.u(22);
select tests.authenticate_as('dr_22');
select lives_ok($$ select respond_to_dispatch_offer(gen_random_uuid(), 'accept') $$, 'the window rolls: calls older than a minute no longer count');
reset role;

-- ---------------------------------------------------------------------------
-- 10. admin_set_dispatch_setting: new keys and the ring rule
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
create temp table audit0 as select count(*) as n from admin_audit_log where action = 'dispatch_setting.set';
grant all on audit0 to public;

select lives_ok(format($$ select admin_set_dispatch_setting('dispatch_offer_timeout_seconds', 30, 'tune', %L::uuid) $$, pg_temp.s('admin')), 'offer timeout 30 accepted');
select is(_dispatch_offer_ttl(), interval '30 seconds', 'the engine TTL follows the setting');
select lives_ok(format($$ select admin_set_dispatch_setting('dispatch_h3_resolution', 9, 'tune', %L::uuid) $$, pg_temp.s('admin')), 'h3 resolution 9 accepted');
select lives_ok(format($$ select admin_set_dispatch_setting('dispatch_default_speed_kmh', 25, 'tune', %L::uuid) $$, pg_temp.s('admin')), 'speed 25 accepted');
select lives_ok(format($$ select admin_set_dispatch_setting('dispatch_road_factor_pct', 150, 'tune', %L::uuid) $$, pg_temp.s('admin')), 'road factor 150 accepted');
select throws_like(format($$ select admin_set_dispatch_setting('dispatch_default_speed_kmh', 4, 'x', %L::uuid) $$, pg_temp.s('admin')), '%between 5 and 60%', 'speed 4 refused with a plain message');
select throws_like(format($$ select admin_set_dispatch_setting('dispatch_offer_timeout_seconds', 5, 'x', %L::uuid) $$, pg_temp.s('admin')), '%between 15 and 120%', 'timeout 5 refused');
select throws_like(format($$ select admin_set_dispatch_setting('dispatch_h3_max_ring', 31, 'x', %L::uuid) $$, pg_temp.s('admin')), '%between 1 and 30%', 'max ring 31 refused');
select throws_like(format($$ select admin_set_dispatch_setting('dispatch_nonsense', 5, 'x', %L::uuid) $$, pg_temp.s('admin')), '%unknown dispatch setting%', 'unknown key refused');
select throws_like(format($$ select admin_set_dispatch_setting('dispatch_h3_initial_ring', 9, 'x', %L::uuid) $$, pg_temp.s('admin')), '%cannot be more than the furthest search ring (8)%', 'first rings 9 > furthest 8: refused');
select lives_ok(format($$ select admin_set_dispatch_setting('dispatch_h3_initial_ring', 8, 'ok', %L::uuid) $$, pg_temp.s('admin')), 'first rings may equal the furthest ring');
select throws_like(format($$ select admin_set_dispatch_setting('dispatch_h3_max_ring', 7, 'x', %L::uuid) $$, pg_temp.s('admin')), '%cannot be less than the number of first search rings (8)%', 'furthest ring below the first rings: refused');
select lives_ok(format($$ select admin_set_dispatch_setting('dispatch_h3_initial_ring', 1, 'back', %L::uuid) $$, pg_temp.s('admin')), 'first rings back to 1');
select lives_ok(format($$ select admin_set_dispatch_setting('dispatch_h3_max_ring', 5, 'ok', %L::uuid) $$, pg_temp.s('admin')), 'furthest ring 5 now allowed');
select is((select count(*) from admin_audit_log where action = 'dispatch_setting.set') - (select n from audit0), 7::bigint, 'one audit row per real change (7), none for refusals');
-- restore what later scenarios read
select admin_set_dispatch_setting('dispatch_offer_timeout_seconds', 45, 'restore', pg_temp.s('admin'));
select admin_set_dispatch_setting('dispatch_h3_resolution', 8, 'restore', pg_temp.s('admin'));
select admin_set_dispatch_setting('dispatch_default_speed_kmh', 18, 'restore', pg_temp.s('admin'));
select admin_set_dispatch_setting('dispatch_road_factor_pct', 135, 'restore', pg_temp.s('admin'));
select admin_set_dispatch_setting('dispatch_h3_max_ring', 8, 'restore', pg_temp.s('admin'));
reset role;

-- ---------------------------------------------------------------------------
-- 11. admin_dispatch_status: reasons, live offer, upcoming
-- ---------------------------------------------------------------------------

select pg_temp.mk_order('20', 'ready_for_pickup', false, interval '5 minutes');   -- live offer
select pg_temp.mk_order('21', 'ready_for_pickup', false, interval '5 minutes');   -- nothing asked
select pg_temp.mk_order('22', 'ready_for_pickup', false, interval '5 minutes');   -- one declined offer
select pg_temp.mk_order('23', 'ready_for_pickup', false, interval '5 minutes');   -- radius case
select pg_temp.mk_order('24', 'ready_for_pickup', true, interval '5 minutes');    -- small: unfundable
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, expires_at) values
  (pg_temp.oid('20'), pg_temp.u(24), 'offered', 1, 1, now() + interval '30 seconds');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no) values
  (pg_temp.oid('22'), pg_temp.u(25), 'declined', 1, 1);
update riders set is_online = true, last_ping_at = now() where user_id = pg_temp.u(24);
select pg_temp.adv('20');                                                           -- creates the order_dispatch row around the manual offer
select pg_temp.mk_order('25', 'accepted', false, interval '0');
select pg_temp.adv('25');                                                           -- scheduled, start in the future

create function pg_temp.reason(p_status jsonb, p_n text) returns text language sql as $$
  select o ->> 'reason' from jsonb_array_elements(p_status -> 'stuck_orders') o where o ->> 'order_id' = pg_temp.oid(p_n)::text $$;

select pg_temp.only(pg_temp.u(26));                                                 -- nobody eligible except r26... then offline:
update riders set is_online = false;
select tests.authenticate_as_service_role();
insert into res select 'st1', admin_dispatch_status();
reset role;
select is(pg_temp.reason((select v from res where k = 'st1'), '20'), 'waiting_for_rider_reply', 'reason: live offer -> waiting_for_rider_reply');
select is(pg_temp.reason((select v from res where k = 'st1'), '21'), 'no_online_riders', 'reason: nobody online -> no_online_riders');
select ok((select o -> 'live_offer' ->> 'rider_name' = 'Rider Twentyfour'
                  and (o -> 'live_offer' ->> 'seconds_left')::int between 1 and 30
                  and (o -> 'live_offer' ->> 'attempt_no')::int = 1 and o ->> 'dispatch_state' = 'offered'
           from jsonb_array_elements((select v from res where k = 'st1') -> 'stuck_orders') o where o ->> 'order_id' = pg_temp.oid('20')::text),
  'live_offer carries rider name, seconds_left and attempt');
select ok((select (o ->> 'attempts_made')::int = 1 and o ->> 'offers_open' = '1' and (o ->> 'cycle_no')::int = 1
                  and o ->> 'start_at' is not null and o ->> 'expected_ready_at' is not null and o ->> 'needs_attention' = 'false'
           from jsonb_array_elements((select v from res where k = 'st1') -> 'stuck_orders') o where o ->> 'order_id' = pg_temp.oid('20')::text),
  'attempts_made and the old offers_open key');
select ok((select v ? 'upcoming' and v ? 'needs_attention_count' and v -> 'settings' ? 'offer_timeout_seconds' and v -> 'settings' ? 'h3_max_ring'
                  and v -> 'settings' ? 'vendor_arrival_radius_m' and v -> 'settings' ? 'radius_m' from res where k = 'st1'),
  'settings carry the new keys and the old ones; upcoming and needs_attention_count exist');
select ok(exists (select 1 from jsonb_array_elements((select v from res where k = 'st1') -> 'upcoming') u
                  where u ->> 'order_id' = pg_temp.oid('25')::text and (u ->> 'starts_in_seconds')::int > 0 and u ->> 'expected_ready_at' is not null),
  'a scheduled order is listed in upcoming with its predicted start');
select ok(not exists (select 1 from jsonb_array_elements((select v from res where k = 'st1') -> 'stuck_orders') o where o ->> 'order_id' = pg_temp.oid('25')::text),
  '... and not in stuck_orders');

select pg_temp.only(pg_temp.u(23));
select tests.authenticate_as_service_role();
insert into res select 'st2', admin_dispatch_status();
reset role;
select is(pg_temp.reason((select v from res where k = 'st2'), '22'), 'all_declined_or_expired', 'reason: riders available, offers made, none live -> all_declined_or_expired');
select is(pg_temp.reason((select v from res where k = 'st2'), '21'), 'needs_attention', 'reason: riders available but nobody was ever asked -> needs_attention');
select is(pg_temp.reason((select v from res where k = 'st2'), '24'), 'fee_exceeds_order_budget', 'reason: small order, rider too far to fund -> fee_exceeds_order_budget');

select pg_temp.only(pg_temp.s('far'));
select tests.authenticate_as_service_role();
select admin_set_dispatch_setting('dispatch_radius_m', 1000, 'test', pg_temp.s('admin'));
select admin_set_dispatch_setting('dispatch_widen_after_seconds', 0, 'test', pg_temp.s('admin'));
insert into res select 'st3', admin_dispatch_status();
select admin_set_dispatch_setting('dispatch_radius_m', 0, 'restore', pg_temp.s('admin'));
select admin_set_dispatch_setting('dispatch_widen_after_seconds', 60, 'restore', pg_temp.s('admin'));
reset role;
select is(pg_temp.reason((select v from res where k = 'st3'), '23'), 'none_in_range', 'reason: a 1 km cap and the only rider 6.6 km away -> none_in_range');
select ok(not exists (select 1 from jsonb_array_elements((select v from res where k = 'st1') -> 'stuck_orders') o where o ->> 'reason' = 'offers_pending'),
  'the old reason offers_pending is gone');
select throws_ok($$ select admin_dispatch_status() $$, 'P0001', null, 'admin_dispatch_status still needs the service role');

-- ---------------------------------------------------------------------------
-- 12. admin_dispatch_order_history
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
insert into res select 'h1', admin_dispatch_order_history(pg_temp.oid('05'));
select throws_like(format($$ select admin_dispatch_order_history(%L::uuid) $$, gen_random_uuid()), '%does not exist%', 'history of a missing order raises');
reset role;
select ok((select v ? 'order' and v ? 'dispatch' and v ? 'offers' and v ? 'events' from res where k = 'h1'), 'history: order, dispatch, offers, events');
select is((select jsonb_array_length(v -> 'offers') from res where k = 'h1'), 2, 'history: both offers of order 05');
select ok((select (v -> 'offers' -> 0) ?& array['offer_id', 'rider_id', 'rider_name', 'cycle_no', 'attempt_no', 'ring', 'distance_m', 'eta_seconds',
                                                 'status', 'close_reason', 'offered_at', 'responded_at', 'seconds_to_respond'] from res where k = 'h1'),
  'history: every offer carries the documented keys');
select is((select v -> 'offers' -> 0 ->> 'status' from res where k = 'h1'), 'declined', 'history: offers ordered by attempt (first = declined)');
select ok((select (v -> 'offers' -> 0 ->> 'seconds_to_respond') is not null from res where k = 'h1'), 'history: seconds_to_respond for a responded offer');
select ok((select jsonb_array_length(v -> 'events') >= 4 and v -> 'events' -> 0 ? 'event' from res where k = 'h1'), 'history: events present');
select is((select v #>> '{dispatch,state}' from res where k = 'h1'), 'assigned', 'history: the order_dispatch row');
select throws_ok(format($$ select admin_dispatch_order_history(%L::uuid) $$, pg_temp.oid('05')), 'P0001', null, 'history needs the service role');

-- ---------------------------------------------------------------------------
-- 13. Vendor view: old keys kept, new fields added
-- ---------------------------------------------------------------------------

select tests.authenticate_as('dr_vendor');
insert into res select 'v1', vendor_dispatch_state(pg_temp.oid('25'));
insert into res select 'v2', vendor_dispatch_state(pg_temp.oid('01'));
insert into res select 'v3', vendor_dispatch_state(pg_temp.oid('20'));
reset role;
select ok((select v ?& array['state', 'can_expand', 'expand_available_in_seconds', 'riders_in_range', 'radius_m', 'base_radius_m', 'store_radius_m', 'expansions_used'] from res where k = 'v1'),
  'vendor view keeps every old key');
select is((select v ->> 'state' from res where k = 'v1'), 'offers_pending', 'scheduled order: state stays offers_pending (compat)');
select is((select v ->> 'dispatch_state' from res where k = 'v1'), 'scheduled', '... dispatch_state scheduled');
select ok((select (v ->> 'start_at')::timestamptz > now() and v ->> 'expected_ready_at' is not null and v ->> 'searching_since' is null
                  and (v ->> 'attempts_made')::int = 0 and not (v ->> 'can_expand')::boolean from res where k = 'v1'),
  '... start_at in the future, expected_ready_at set, not searching yet, no attempts, cannot expand');
select is((select v ->> 'state' || '/' || (v ->> 'dispatch_state') from res where k = 'v2'), 'rider_assigned/assigned', 'assigned order: rider_assigned / assigned');
select ok((select (v ->> 'assigned_eta_at')::timestamptz > now() from res where k = 'v2'), '... with the rider ETA');
select is((select (v ->> 'attempts_made')::int from res where k = 'v3'), 1, 'order with an offer: attempts_made 1');
select tests.authenticate_as('dr_vendor');
select throws_like(format($$ select vendor_expand_rider_search(%L::uuid) $$, pg_temp.oid('25')), '%has not started yet%', 'expanding before the search started is refused (no expansion wasted)');
reset role;
select is((select count(*) from dispatch_expansions where order_id = pg_temp.oid('25')), 0::bigint, '... and recorded nothing');

-- vendor self delivery: the live offer is cancelled, dispatch stopped
select tests.authenticate_as('dr_vendor');
select lives_ok(format($$ select vendor_start_self_delivery(%L::uuid) $$, pg_temp.oid('20')), 'vendor chooses to deliver order 20 themselves');
reset role;
select is(pg_temp.st('20', pg_temp.u(24)), 'cancelled/vendor_self_delivery', 'the live offer is cancelled (vendor_self_delivery)');
select is((select state from order_dispatch where order_id = pg_temp.oid('20')), 'stopped', 'dispatch state: stopped');

-- redispatch keeps a live offer and reports it
select pg_temp.only(pg_temp.u(25), pg_temp.u(26));
select pg_temp.mk_order('26');
select pg_temp.adv('26');
select tests.authenticate_as_service_role();
insert into res select 'rd1', admin_redispatch_order(pg_temp.oid('26'), 'check', pg_temp.s('admin'));
reset role;
select is((select v ->> 'offers_created' || '/' || (v ->> 'live_offer') || '/' || (v ->> 'outcome') from res where k = 'rd1'), '0/true/waiting', 'redispatch with a live offer: kept, nothing new, reported');
select is(pg_temp.cnt('26'), 1::bigint, '... still one offer on the order');

select * from finish();
rollback;
