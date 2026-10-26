-- pgTAP: dispatch review fixes (0109).
--
--  1. A failing start estimate never fails the vendor's Accept (fallback formula + event).
--  2. _dispatch_advance 'busy' outcome: counter, event, no funnel/vendor notice/needs_attention,
--     escalation to a wider look after 3 busy runs, fall-through, reset.
--  3. Parity: the scan's inline SQL predicates versus _dispatch_rider_available /
--     _dispatch_rider_excluded for riders in every state that matters (complements the 0108
--     parity block in dispatch_engine.sql), so drift between them is caught.
--  4. One-off reschedule of backfilled, never-started orders.
--  5. Hygiene: grants, pinned search_path, small legacy-wrapper batches.
--  6. admin_dispatch_health().
--
-- The busy path needs "returned by the scan but refused under the lock". A second session cannot be
-- used inside one rolled-back transaction, so the re-check helper is wrapped for the test (a
-- temp-table block list); the real lock contention is covered by the concurrency harness
-- (scenario 8.1 and the invariant "no rider holds two live offers").
--
-- Geometry: vendor at POINT(7.5 9.5), riders east of it, 110 m apart.

begin;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('rf_customer');
select tests.create_supabase_user('rf_vendor');
select tests.create_supabase_user('rf_r' || n) from generate_series(1, 8) n;
select tests.create_supabase_user('rf_q' || n) from generate_series(1, 20) n;

insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
values ('dd000000-0000-7000-8000-000000000501', 'RF Area',
        st_geogfromtext('POLYGON((7.0 9.0, 8.5 9.0, 8.5 10.0, 7.0 10.0, 7.0 9.0))'), true, 50000, 15000, 50000, 15000);

insert into vendors (id, owner_user_id, name, slug, status, location, commission_bps, delivery_radius_m, avg_prep_mins)
values ('dd000000-0000-7000-8000-000000000511', tests.get_supabase_uid('rf_vendor'), 'RF Bakery', 'rf-v1', 'active',
        st_geogfromtext('POINT(7.5 9.5)'), 1500, 20000, 20);

insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
select tests.get_supabase_uid('rf_r' || n), true, 'approved', st_geogfromtext('POINT(' || (7.5 + 0.001 * n) || ' 9.5)'), now()
from generate_series(1, 8) n;
insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
select tests.get_supabase_uid('rf_q' || n), true, 'approved', st_geogfromtext('POINT(' || (7.5 + 0.0004 * n) || ' 9.51)'), now()
from generate_series(1, 20) n;

create function pg_temp.uid(p text) returns uuid language sql as $$ select tests.get_supabase_uid('rf_' || p) $$;
create function pg_temp.oid(p_n text) returns uuid language sql as $$ select ('dd000000-0000-7000-8000-0000000005' || p_n)::uuid $$;

create function pg_temp.mk_order(p_n text, p_status order_status default 'ready_for_pickup', p_rider text default null)
returns void language sql as $$
  insert into orders (id, customer_id, vendor_id, service_area_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo,
                      discount_kobo, total_kobo, delivery_address, delivery_location, rider_id, ready_at, accepted_at, first_dispatched_at, delivery_by)
  values (pg_temp.oid(p_n), tests.get_supabase_uid('rf_customer'), 'dd000000-0000-7000-8000-000000000511',
          'dd000000-0000-7000-8000-000000000501', p_status, 'paid', 5000000, 50000, 100000, 0, 5150000,
          '{"line1": "77 Secret Close"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'),
          case when p_rider is null then null else pg_temp.uid(p_rider) end,
          case when p_status = 'ready_for_pickup' then now() - interval '10 minutes' end, now(),
          case when p_status = 'ready_for_pickup' then now() - interval '10 minutes' end, 'rider');
$$;

create function pg_temp.only(variadic p_names text[]) returns void language sql as $$
  delete from dispatch_offers;
  update riders set is_online = exists (select 1 from unnest(p_names) n where pg_temp.uid(n) = riders.user_id), last_ping_at = now();
$$;
create function pg_temp.live_rider(p_n text) returns uuid language sql as $$
  select rider_id from dispatch_offers where order_id = pg_temp.oid(p_n) and status = 'offered' $$;
create function pg_temp.ev(p_n text, p_event text) returns bigint language sql as $$
  select count(*) from dispatch_events where order_id = pg_temp.oid(p_n) and event = p_event $$;
create function pg_temp.adv(p_n text) returns jsonb language sql as $$ select _dispatch_advance(pg_temp.oid(p_n), 'tick') $$;

create temp table keep_def (k text primary key, def text);
grant all on keep_def to public;

-- ---------------------------------------------------------------------------
-- 1. A failing start estimate never fails the vendor's Accept
-- ---------------------------------------------------------------------------

insert into keep_def select 'start_calc', pg_get_functiondef('public._dispatch_start_calc(orders, timestamptz)'::regprocedure);
create or replace function _dispatch_start_calc(p_order orders, p_expected_ready_at timestamptz default null)
returns table(start_at timestamptz, basis jsonb) language plpgsql as $$
begin
  raise exception 'simulated estimation failure';
end $$;

select pg_temp.mk_order('01', 'placed');
select pg_temp.mk_order('02', 'placed');
update orders set accepted_at = null where id in (pg_temp.oid('01'), pg_temp.oid('02'));
select lives_ok(format($q$update orders set status = 'accepted', accepted_at = %L where id = %L$q$,
                       date_trunc('second', now()), pg_temp.oid('01')),
  'fallback: the accept does not fail when the start estimate raises');
select is((select od.start_at from order_dispatch od where od.order_id = pg_temp.oid('01')),
          (select o.accepted_at + interval '20 minutes' - interval '750 seconds' from orders o where o.id = pg_temp.oid('01')),
  'fallback: start_at = expected ready (accepted + 20 min) - default travel 600 s - buffer 150 s');
select is((select od.state from order_dispatch od where od.order_id = pg_temp.oid('01')), 'scheduled', 'fallback: the order is scheduled');
select is((select od.start_basis ->> 'fallback' from order_dispatch od where od.order_id = pg_temp.oid('01')), 'true', 'fallback: the basis says so');
select is((select od.start_basis ->> 'travel_source' from order_dispatch od where od.order_id = pg_temp.oid('01')), 'default', 'fallback: default travel source');
select is(pg_temp.ev('01', 'start_calc_failed'), 1::bigint, 'fallback: one start_calc_failed event');
select ok((select (e.data ->> 'error') like '%simulated estimation failure%' from dispatch_events e where e.order_id = pg_temp.oid('01') and e.event = 'start_calc_failed'),
  'fallback: the event carries the error text');
select is(pg_temp.ev('01', 'scheduled'), 1::bigint, 'fallback: the scheduled event is still written');

-- never before accepted_at
update vendors set avg_prep_mins = 5 where id = 'dd000000-0000-7000-8000-000000000511';
select lives_ok(format($q$update orders set status = 'accepted', accepted_at = %L where id = %L$q$,
                       date_trunc('second', now()), pg_temp.oid('02')), 'fallback (short prep): accept ok');
select is((select od.start_at from order_dispatch od where od.order_id = pg_temp.oid('02')),
          (select o.accepted_at from orders o where o.id = pg_temp.oid('02')),
  'fallback: start_at never before accepted_at');
update vendors set avg_prep_mins = 20 where id = 'dd000000-0000-7000-8000-000000000511';

do $$ begin execute (select def from keep_def where k = 'start_calc'); end $$;
select pg_temp.mk_order('03', 'placed');
update orders set accepted_at = null where id = pg_temp.oid('03');
update orders set status = 'accepted', accepted_at = date_trunc('second', now()) where id = pg_temp.oid('03');
select is((select od.start_basis ->> 'fallback' from order_dispatch od where od.order_id = pg_temp.oid('03')), null,
  'fallback: with the estimator restored the normal basis is stored (no fallback flag)');
select is(pg_temp.ev('03', 'start_calc_failed'), 0::bigint, 'fallback: no failure event when the estimate works');

-- ---------------------------------------------------------------------------
-- 2. Busy outcome
-- ---------------------------------------------------------------------------

-- Wrap the under-lock availability re-check: riders in pg_temp.blocked are refused although the scan's
-- inline predicates still return them (this is exactly what drift or a lost race looks like).
create temp table blocked (uid uuid primary key);
grant all on blocked to public;
alter function _dispatch_rider_available(uuid) rename to _dispatch_rider_available_orig;
create function _dispatch_rider_available(p_rider_id uuid) returns boolean language sql stable as $$
  select case when exists (select 1 from pg_temp.blocked b where b.uid = p_rider_id) then false
              else _dispatch_rider_available_orig(p_rider_id) end
$$;

select pg_temp.only('r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7');
insert into blocked select pg_temp.uid('r' || n) from generate_series(1, 5) n;   -- the 5 nearest are refused
select pg_temp.mk_order('11');

select is(pg_temp.adv('11') ->> 'outcome', 'busy', 'busy 1: candidates found but none could be asked -> busy (not no_candidates)');
select is((select busy_count from order_dispatch where order_id = pg_temp.oid('11')), 1, 'busy 1: counter 1');
select ok((select next_check_at between now() + interval '3 seconds' and now() + interval '6 seconds' from order_dispatch where order_id = pg_temp.oid('11')),
  'busy 1: retry in about 5 s, not 15');
select is(pg_temp.adv('11') ->> 'outcome', 'busy', 'busy 2');
select is(pg_temp.adv('11') ->> 'outcome', 'busy', 'busy 3');
select is((select busy_count from order_dispatch where order_id = pg_temp.oid('11')), 3, 'busy 3: counter 3');
select is(pg_temp.ev('11', 'dispatch_busy'), 3::bigint, 'busy: one event per busy run');
select is((select (e.data ->> 'rejected')::int from dispatch_events e where e.order_id = pg_temp.oid('11') and e.event = 'dispatch_busy'
           order by e.at, e.id limit 1) >= 5, true, 'busy: the event counts the refused riders');
select is(pg_temp.ev('11', 'no_candidates'), 0::bigint, 'busy: no no_candidates event');
select is((select count(*) from dispatch_attempts where order_id = pg_temp.oid('11')), 0::bigint, 'busy: no funnel row');
select is((select count(*) from notifications where order_id = pg_temp.oid('11') and kind = 'no_rider_nearby'), 0::bigint, 'busy: no vendor notice');
select is((select state from order_dispatch where order_id = pg_temp.oid('11')), 'searching', 'busy: state stays searching');
select is((select attention_reason from order_dispatch where order_id = pg_temp.oid('11')), null, 'busy: not needs_attention (order waited 10 min)');
select is((select count(*) from dispatch_offers where order_id = pg_temp.oid('11')), 0::bigint, 'busy: no offer was made');
select is((select cycle_no from order_dispatch where order_id = pg_temp.oid('11')), 1, 'busy: the cycle was not burnt');

-- after 3 busy runs the pass looks at 25 candidates and reaches the 6th rider
select is(pg_temp.adv('11') ->> 'outcome', 'offered', 'escalation: the 4th run offers a rider beyond the refused top five');
select is(pg_temp.live_rider('11'), pg_temp.uid('r6'), 'escalation: the offer goes to the 6th nearest');
select is((select busy_count from order_dispatch where order_id = pg_temp.oid('11')), 0, 'escalation: an offer resets the counter');

-- everybody refused: busy x3, then the normal no-candidates path (and the counter resets)
select pg_temp.only('r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7');
insert into blocked select pg_temp.uid('r' || n) from generate_series(6, 7) n;
select pg_temp.mk_order('12');
select pg_temp.adv('12'); select pg_temp.adv('12'); select pg_temp.adv('12');
select is((select busy_count from order_dispatch where order_id = pg_temp.oid('12')), 3, 'fall-through: three busy runs');
select is(pg_temp.adv('12') ->> 'outcome', 'no_candidates', 'fall-through: the escalated run that still finds nobody is a normal no_candidates');
select is((select busy_count from order_dispatch where order_id = pg_temp.oid('12')), 0, 'fall-through: counter reset');
select is(pg_temp.ev('12', 'no_candidates'), 1::bigint, 'fall-through: no_candidates event now written');
select is((select count(*) from dispatch_attempts where order_id = pg_temp.oid('12')), 1::bigint, 'fall-through: funnel row now written');
select is(pg_temp.ev('12', 'dispatch_busy'), 3::bigint, 'fall-through: still exactly three busy events');

-- a busy run followed by a recovered rider offers normally
select pg_temp.only('r1', 'r2');
delete from blocked;
insert into blocked values (pg_temp.uid('r1')), (pg_temp.uid('r2'));
select pg_temp.mk_order('13');
select is(pg_temp.adv('13') ->> 'outcome', 'busy', 'recovery: busy while both are refused');
delete from blocked;
select is(pg_temp.adv('13') ->> 'outcome', 'offered', 'recovery: offered as soon as a rider is askable');
select is(pg_temp.live_rider('13'), pg_temp.uid('r1'), 'recovery: the nearest rider');
select is((select busy_count from order_dispatch where order_id = pg_temp.oid('13')), 0, 'recovery: counter reset');

-- genuinely nobody (no candidates at all) is still no_candidates, never busy
select pg_temp.only(variadic array[]::text[]);
select pg_temp.mk_order('14');
select is(pg_temp.adv('14') ->> 'outcome', 'no_candidates', 'no riders online: no_candidates, not busy');
select is((select busy_count from order_dispatch where order_id = pg_temp.oid('14')), 0, 'no riders online: counter untouched');

-- the 30-minute give-up still sees the escalated fall-through as no_candidates (not busy) -> reachable
select is((select count(*) from dispatch_events where order_id = pg_temp.oid('14') and event = 'no_candidates'), 1::bigint, 'no riders: funnel event');

drop function _dispatch_rider_available(uuid);
alter function _dispatch_rider_available_orig(uuid) rename to _dispatch_rider_available;
select ok(not has_function_privilege('authenticated', '_dispatch_rider_available(uuid)', 'execute'), 'helper restored with its internal-only grants');

-- ---------------------------------------------------------------------------
-- 3. Parity: scan inline predicates vs the helpers, one rider per state
-- ---------------------------------------------------------------------------

select pg_temp.only(variadic array[]::text[]);
update riders set is_online = true, last_ping_at = now() where user_id in (select pg_temp.uid('q' || n) from generate_series(1, 20) n);
select pg_temp.mk_order('50');                                 -- the order being dispatched (cycle 2 below)
select pg_temp.mk_order('51', 'accepted', 'q2');
select pg_temp.mk_order('52', 'preparing', 'q3');
select pg_temp.mk_order('53', 'rider_assigned', 'q4');
select pg_temp.mk_order('54', 'picked_up', 'q5');
select pg_temp.mk_order('55', 'arrived', 'q6');
select pg_temp.mk_order('56', 'delivered', 'q14');
select pg_temp.mk_order('57', 'in_transit', 'q15');
select pg_temp.mk_order('58');                                 -- carries q16's live offer
select pg_temp.mk_order('59');                                 -- carries q11's lapsed 'offered' row
update profiles set status = 'deleted'    where id = pg_temp.uid('q7');
update riders   set kyc_status = 'rejected' where user_id = pg_temp.uid('q8');
update riders   set kyc_status = 'pending'  where user_id = pg_temp.uid('q17');
update riders   set last_ping_at = now() - interval '295 seconds' where user_id = pg_temp.uid('q12');   -- inside 300 s
update riders   set last_ping_at = now() - interval '310 seconds' where user_id = pg_temp.uid('q13');   -- outside 300 s
update riders   set is_online = false where user_id = pg_temp.uid('q18');
update riders   set current_location = null where user_id = pg_temp.uid('q19');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at) values
  (pg_temp.oid('50'), pg_temp.uid('q9'),  'revoked',  1, 1, now() - interval '5 minutes', now() - interval '4 minutes'),   -- revoked here: excluded forever
  (pg_temp.oid('50'), pg_temp.uid('q10'), 'declined', 1, 2, now() - interval '5 minutes', now() - interval '4 minutes'),   -- declined in an older cycle: still excluded
  (pg_temp.oid('50'), pg_temp.uid('q20'), 'expired',  2, 3, now() - interval '3 minutes', now() - interval '2 minutes'),   -- asked in THIS cycle (2)
  (pg_temp.oid('58'), pg_temp.uid('q16'), 'offered',  1, 1, now(), now() + interval '30 seconds');                         -- live elsewhere
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
values (pg_temp.oid('59'), pg_temp.uid('q11'), 'offered', 1, 1, now() - interval '2 minutes', now() - interval '1 minute');  -- lapsed, status not yet updated

create temp table par_helper as
select r.user_id as uid from riders r
where _dispatch_rider_available(r.user_id) and not _dispatch_rider_excluded(pg_temp.oid('50'), r.user_id, 2)
  and r.user_id in (select pg_temp.uid('q' || n) from generate_series(1, 20) n);
create temp table par_knn as
select c.rider_id as uid from _dispatch_candidates(pg_temp.oid('50'), null, null, 2, 1000) c
where c.rider_id in (select pg_temp.uid('q' || n) from generate_series(1, 20) n);
create temp table par_ring as
select c.rider_id as uid from _dispatch_candidates(pg_temp.oid('50'), 8, null, 2, 1000) c
where c.rider_id in (select pg_temp.uid('q' || n) from generate_series(1, 20) n);

select ok(exists (select 1 from par_helper where uid = pg_temp.uid('q1')) and exists (select 1 from par_helper where uid = pg_temp.uid('q12'))
          and exists (select 1 from par_helper where uid = pg_temp.uid('q11')) and exists (select 1 from par_helper where uid = pg_temp.uid('q14')),
  'parity: helpers accept healthy, fresh-ping (295 s), lapsed-offer-elsewhere and finished-order riders');
select ok(not exists (select 1 from par_helper where uid in (select pg_temp.uid('q' || n) from unnest(array[2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16, 17, 18, 19, 20]) n)),
  'parity: helpers reject accepted/preparing/assigned/picked-up/arrived/in-transit riders, deleted profile, rejected/pending kyc, revoked, declined-older-cycle, this-cycle, stale 310 s ping, live-elsewhere, offline, no location');
select is((select coalesce(array_agg(uid order by uid), '{}') from (select uid from par_helper except select uid from par_knn) x), '{}'::uuid[],
  'parity KNN: every helper-accepted rider is a candidate');
select is((select coalesce(array_agg(uid order by uid), '{}') from (select uid from par_knn except select uid from par_helper) x), '{}'::uuid[],
  'parity KNN: no candidate the helpers would reject');
select is((select coalesce(array_agg(uid order by uid), '{}') from (select uid from par_helper except select uid from par_ring) x), '{}'::uuid[],
  'parity rings: every helper-accepted rider is a candidate');
select is((select coalesce(array_agg(uid order by uid), '{}') from (select uid from par_ring except select uid from par_helper) x), '{}'::uuid[],
  'parity rings: no candidate the helpers would reject');
select cmp_ok((select count(*) from par_helper), '>=', 4::bigint, 'parity: the helpers accept a non-trivial set');

-- ---------------------------------------------------------------------------
-- 4. One-off reschedule of backfilled never-started orders
-- ---------------------------------------------------------------------------

select pg_temp.mk_order('60', 'preparing');                    -- backfilled shape: searching, no start_at, no offers
select pg_temp.mk_order('61', 'preparing');                    -- already dispatching: has an offer
select pg_temp.mk_order('62', 'ready_for_pickup');             -- ready: never touched
update orders set accepted_at = now() where id in (pg_temp.oid('60'), pg_temp.oid('61'));
insert into order_dispatch (order_id, state, next_check_at, expected_ready_at) values
  (pg_temp.oid('60'), 'searching', now(), now() + interval '20 minutes'),
  (pg_temp.oid('61'), 'offered',   now(), now() + interval '20 minutes'),
  (pg_temp.oid('62'), 'searching', now(), now())
on conflict (order_id) do update set state = excluded.state, next_check_at = excluded.next_check_at,
  expected_ready_at = excluded.expected_ready_at, start_at = null, dispatch_started_at = null, attempt_no = 0;
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
values (pg_temp.oid('61'), pg_temp.uid('r8'), 'offered', 1, 1, now(), now() + interval '30 seconds');
update order_dispatch set attempt_no = 1, dispatch_started_at = now() where order_id = pg_temp.oid('61');

select cmp_ok(_dispatch_reschedule_unstarted(), '>=', 1, 'reschedule: at least the backfilled order is re-planned');
select is((select state from order_dispatch where order_id = pg_temp.oid('60')), 'scheduled', 'reschedule: backfilled order is scheduled again');
select ok((select start_at > now() + interval '5 minutes' from order_dispatch where order_id = pg_temp.oid('60')),
  'reschedule: predictive start in the future (20 min prep) instead of immediate');
select ok((select next_check_at <= now() + interval '61 seconds' from order_dispatch where order_id = pg_temp.oid('60')), 'reschedule: re-checked within a minute');
select is((select state from order_dispatch where order_id = pg_temp.oid('61')), 'offered', 'reschedule: an order already dispatching is untouched');
select is((select state from order_dispatch where order_id = pg_temp.oid('62')), 'searching', 'reschedule: a ready order is untouched');
select is(_dispatch_reschedule_unstarted(), 0, 'reschedule: idempotent');

-- ---------------------------------------------------------------------------
-- 5. Hygiene
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege('anon', 'accept_dispatch_offer(uuid)', 'execute'), 'anon cannot execute accept_dispatch_offer');
select ok(not has_function_privilege('anon', 'decline_dispatch_offer(uuid)', 'execute'), 'anon cannot execute decline_dispatch_offer');
select ok(has_function_privilege('authenticated', 'accept_dispatch_offer(uuid)', 'execute')
      and has_function_privilege('authenticated', 'decline_dispatch_offer(uuid)', 'execute'), 'riders (authenticated) still can');
select ok(not has_function_privilege('anon', 'dispatch_order_to_nearby_riders()', 'execute')
      and not has_function_privilege('authenticated', 'dispatch_order_to_nearby_riders()', 'execute'),
  'the ready-trigger function is not callable by anon / authenticated');
select ok((select proconfig from pg_proc where proname = '_dispatch_worker_caller_ok') @> array['search_path=public'], '_dispatch_worker_caller_ok pins search_path');
select ok(pg_get_functiondef('sweep_dispatch_offers()'::regprocedure) like '%_dispatch_tick_run(10,%', 'sweep_dispatch_offers processes at most 10 orders');
select ok(pg_get_functiondef('dispatch_orders_nearing_prep_completion()'::regprocedure) like '%limit 10%', 'early-dispatch wrapper processes at most 10 orders');
select ok((select prokind = 'p' from pg_proc where proname = 'dispatch_tick'), 'dispatch_tick (the scheduled worker) is a procedure');
select ok((select prosrc like '%commit;%' from pg_proc where proname = 'dispatch_tick'), 'dispatch_tick commits after every order');
select ok(obj_description('_dispatch_rate_check(uuid)'::regprocedure, 'pg_proc') like '%BEST EFFORT%', 'rate limit is documented as best-effort');
select ok(not has_function_privilege('service_role', '_dispatch_reschedule_unstarted()', 'execute'), 'the one-off reschedule is internal');

-- ---------------------------------------------------------------------------
-- 6. admin_dispatch_health()
-- ---------------------------------------------------------------------------

select is((select count(*) from pg_proc where proname = 'admin_dispatch_health' and prosecdef), 1::bigint, 'health: security definer');
select ok((select proconfig from pg_proc where proname = 'admin_dispatch_health') @> array['search_path=public'], 'health: search_path pinned');
select ok(has_function_privilege('service_role', 'admin_dispatch_health()', 'execute')
      and not has_function_privilege('authenticated', 'admin_dispatch_health()', 'execute')
      and not has_function_privilege('anon', 'admin_dispatch_health()', 'execute'), 'health: service_role only');
select tests.authenticate_as('rf_r1');
select throws_ok('select admin_dispatch_health()', '42501', null, 'health: an authenticated user is refused');
reset role;

-- A controlled world: tick job present with a fresh success, no overdue orders, both secrets.
update order_dispatch set next_check_at = now() + interval '1 hour' where state not in ('assigned', 'stopped');
select cron.unschedule('dispatch-tick') where exists (select 1 from cron.job where jobname = 'dispatch-tick');
select cron.schedule('dispatch-tick', '5 seconds', 'select 1');
delete from vault.secrets where name in ('message_worker_function_url', 'message_worker_secret');

create function pg_temp.health() returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as_service_role();
  v := admin_dispatch_health();
  reset role;
  return v;
end $$;
create function pg_temp.set_run(p_secs_ago integer, p_status text default 'succeeded') returns void language sql as $$
  delete from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'dispatch-tick');
  insert into cron.job_run_details (runid, jobid, status, start_time, end_time)
  select 9000000000 + extract(epoch from clock_timestamp())::bigint, jobid, p_status,
         now() - make_interval(secs => p_secs_ago + 1), now() - make_interval(secs => p_secs_ago)
  from cron.job where jobname = 'dispatch-tick';
$$;

select is(jsonb_typeof(pg_temp.health() -> 'problems'), 'array', 'health: problems is an array');
select ok(pg_temp.health() ?& array['cron_available', 'tick_job_present', 'tick_last_run_at', 'tick_last_status', 'tick_overdue_seconds',
        'oldest_overdue_next_check_seconds', 'orders_overdue', 'worker_secrets_present', 'queued_push_oldest_seconds', 'healthy', 'problems'],
  'health: exactly the contracted keys are present');
select is((select count(*) from jsonb_object_keys(pg_temp.health())), 11::bigint, 'health: no extra keys');

-- never run
select is((pg_temp.health() ->> 'tick_overdue_seconds'), null, 'health: never run -> tick_overdue_seconds null');
select is((pg_temp.health() ->> 'cron_available')::boolean, true, 'health: cron available');
select is((pg_temp.health() ->> 'tick_job_present')::boolean, true, 'health: job present');
select ok(pg_temp.health() -> 'problems' ? 'The dispatch timer has never run successfully', 'health: never run problem listed');
select is((pg_temp.health() ->> 'healthy')::boolean, false, 'health: never run -> unhealthy');

-- secrets missing but timer fine
select pg_temp.set_run(2);
select is((pg_temp.health() ->> 'tick_overdue_seconds')::int, 2, 'health: last success 2 s ago');
select is(pg_temp.health() ->> 'tick_last_status', 'succeeded', 'health: last status');
select is((pg_temp.health() ->> 'worker_secrets_present')::boolean, false, 'health: secrets absent');
select ok(pg_temp.health() -> 'problems' ? 'Rider notifications are not configured: the worker secrets are missing', 'health: secrets problem listed');
select is((pg_temp.health() ->> 'healthy')::boolean, false, 'health: missing secrets -> unhealthy');

-- one secret only is still missing
select vault.create_secret('https://example.invalid/message-worker', 'message_worker_function_url');
select is((pg_temp.health() ->> 'worker_secrets_present')::boolean, false, 'health: one of two secrets is not enough');
select vault.create_secret('s3cret-value', 'message_worker_secret');
select is((pg_temp.health() ->> 'worker_secrets_present')::boolean, true, 'health: both secrets present');
select ok(position('s3cret-value' in pg_temp.health()::text) = 0 and position('example.invalid' in pg_temp.health()::text) = 0, 'health: secret values never returned');

-- all good
select is((pg_temp.health() ->> 'healthy')::boolean, true, 'health: healthy when job fresh, nothing overdue, secrets present');
select is(pg_temp.health() -> 'problems', '[]'::jsonb, 'health: no problems');
select is((pg_temp.health() ->> 'orders_overdue')::int, 0, 'health: no overdue orders');
select is(pg_temp.health() ->> 'oldest_overdue_next_check_seconds', null, 'health: no overdue age');

-- boundary: 30 s is still healthy, 40 s is not
select pg_temp.set_run(30);
select is((pg_temp.health() ->> 'healthy')::boolean, true, 'health: 30 s since the last success is healthy');
select pg_temp.set_run(40);
select is((pg_temp.health() ->> 'healthy')::boolean, false, 'health: 40 s is not');
select ok(pg_temp.health() -> 'problems' ? 'The dispatch timer has not run for 40 seconds', 'health: seconds wording under two minutes');

-- 3 minutes
select pg_temp.set_run(185);
select ok(pg_temp.health() -> 'problems' ? 'The dispatch timer has not run for 3 minutes', 'health: the dead timer is reported in minutes');
select is((pg_temp.health() ->> 'tick_overdue_seconds')::int, 185, 'health: overdue seconds');

-- a failed latest run does not count as a success
select pg_temp.set_run(1, 'failed');
select is(pg_temp.health() ->> 'tick_last_status', 'failed', 'health: last status failed');
select is(pg_temp.health() ->> 'tick_overdue_seconds', null, 'health: only successful runs count (none left)');
select is((pg_temp.health() ->> 'healthy')::boolean, false, 'health: failing timer is unhealthy');

-- overdue orders
select pg_temp.set_run(2);
update order_dispatch set next_check_at = now() - interval '90 seconds' where order_id = pg_temp.oid('11');
select ok((pg_temp.health() ->> 'oldest_overdue_next_check_seconds')::int >= 90, 'health: oldest overdue age >= 90 s');
select cmp_ok((pg_temp.health() ->> 'orders_overdue')::int, '>=', 1, 'health: overdue order counted');
select is((pg_temp.health() ->> 'healthy')::boolean, false, 'health: an order overdue by more than 60 s is unhealthy');
update order_dispatch set next_check_at = now() - interval '20 seconds' where order_id = pg_temp.oid('11');
select is((pg_temp.health() ->> 'healthy')::boolean, true, 'health: 20 s overdue is within tolerance');
update order_dispatch set state = 'assigned', next_check_at = now() - interval '900 seconds' where order_id = pg_temp.oid('11');
select is((pg_temp.health() ->> 'healthy')::boolean, true, 'health: assigned/stopped orders are not "live"');

-- paused job
select cron.alter_job((select jobid from cron.job where jobname = 'dispatch-tick'), active := false);
select is((pg_temp.health() ->> 'tick_job_present')::boolean, false, 'health: a paused job is not present');
select ok(pg_temp.health() -> 'problems' ? 'The dispatch timer is not scheduled (the dispatch-tick job is missing or paused)', 'health: paused job problem');
select is((pg_temp.health() ->> 'healthy')::boolean, false, 'health: paused -> unhealthy');
select cron.alter_job((select jobid from cron.job where jobname = 'dispatch-tick'), active := true);

-- queued messages
insert into message_outbox (kind, channel, category, body, status, created_at)
values ('system', 'push', 'transactional', 'x', 'queued', now() - interval '100 seconds');
select ok((pg_temp.health() ->> 'queued_push_oldest_seconds')::int >= 100, 'health: oldest queued outbox row age');

-- read-only: no writes (the function is STABLE); rows untouched
select is((select provolatile from pg_proc where proname = 'admin_dispatch_health'), 's', 'health: declared STABLE (read-only)');

select * from finish();
rollback;
