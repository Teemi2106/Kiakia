-- pgTAP: the dispatch worker, the rider-push outbox and the cron set (0103).
--
-- What this protects:
-- (1) The tick advances an expired live offer to the next rider, never touches
--     assigned/stopped orders, ignores a stale timer when a fresher live offer
--     exists, and a duplicate tick creates nothing.
-- (2) Failures back off (5 s, 10 s, ...), flag needs_attention('worker_errors') on
--     the 5th consecutive one, and clear on the next success.
-- (3) Recovery: a dispatchable order with no order_dispatch row is picked up;
--     the 30-minute give-up still cancels an exhausted ready order.
-- (4) Offer push through message_outbox: one row per offer (dedupe), ids-only
--     payload, vendor name only, no customer data; closing the offer suppresses a
--     queued push/SMS and queues a "withdrawn" push only when the rider was told.
-- (5) The rider-offer SMS still works with several rows per (order, rider), is not
--     eaten by the push rows in its hourly cap, and still waits 12 s.
-- (6) Cron: dispatch-tick every 5 s as a single CALL, old jobs gone, retention jobs.
--
-- dispatch_tick() itself is a PROCEDURE that COMMITs per order, so it cannot run
-- inside this test's transaction; the tick body is exercised through
-- _dispatch_tick_run() (same claim + same per-order function). The procedure is
-- checked structurally here and run for real by pg_cron (see the sprint log).
--
-- Geometry as dispatch_engine.sql: vendor at POINT(7.5 9.5); riders east of it.

begin;
select no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

select tests.create_supabase_user('dw_customer');
select tests.create_supabase_user('dw_vendor');
select tests.create_supabase_user('dw_' || n) from unnest(array['r1', 'r2', 'r3']) n;

update profiles set full_name = 'Zainab Secretcustomer', phone = '+2348019999999' where id = tests.get_supabase_uid('dw_customer');
update profiles set full_name = 'Rider One', phone = '+2348010001001' where id = tests.get_supabase_uid('dw_r1');
update profiles set full_name = 'Rider Two', phone = '+2348010001002' where id = tests.get_supabase_uid('dw_r2');
update profiles set full_name = 'Rider Three', phone = '+2348010001003' where id = tests.get_supabase_uid('dw_r3');

insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
values ('dd000000-0000-7000-8000-000000000401', 'DW Area',
        st_geogfromtext('POLYGON((7.0 9.0, 8.5 9.0, 8.5 10.0, 7.0 10.0, 7.0 9.0))'), true, 50000, 15000, 50000, 15000);

insert into vendors (id, owner_user_id, name, slug, status, location, commission_bps, delivery_radius_m, avg_prep_mins)
values ('dd000000-0000-7000-8000-000000000411', tests.get_supabase_uid('dw_vendor'), 'DW Bakery', 'dw-v1', 'active',
        st_geogfromtext('POINT(7.5 9.5)'), 1500, 20000, 20);

insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
select tests.get_supabase_uid('dw_' || n), true, 'approved', st_geogfromtext('POINT(' || (7.5 + dx) || ' 9.5)'), now()
from (values ('r1', 0.0045), ('r2', 0.009), ('r3', 0.02)) as t(n, dx);

create function pg_temp.uid(p text) returns uuid language sql as $$ select tests.get_supabase_uid('dw_' || p) $$;
create function pg_temp.oid(p_n text) returns uuid language sql as $$ select ('dd000000-0000-7000-8000-0000000004' || p_n)::uuid $$;

create function pg_temp.mk_order(p_n text, p_status order_status default 'ready_for_pickup', p_rider text default null,
                                 p_first_dispatched interval default '0')
returns void language sql as $$
  insert into orders (id, customer_id, vendor_id, service_area_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo,
                      discount_kobo, total_kobo, delivery_address, delivery_location, rider_id, ready_at, accepted_at, first_dispatched_at, delivery_by)
  values (pg_temp.oid(p_n), tests.get_supabase_uid('dw_customer'), 'dd000000-0000-7000-8000-000000000411',
          'dd000000-0000-7000-8000-000000000401', p_status, 'paid', 5000000, 50000, 100000, 0, 5150000,
          '{"line1": "77 Secret Close"}'::jsonb, st_geogfromtext('POINT(7.45 9.05)'),
          case when p_rider is null then null else pg_temp.uid(p_rider) end,
          case when p_status = 'ready_for_pickup' then now() end, now(),
          case when p_status = 'ready_for_pickup' then now() - p_first_dispatched end, 'rider');
$$;

-- Fresh slate: no offers, only the named riders online.
create function pg_temp.only(variadic p_names text[]) returns void language sql as $$
  delete from dispatch_offers;
  update riders set is_online = exists (select 1 from unnest(p_names) n where pg_temp.uid(n) = riders.user_id), last_ping_at = now();
$$;

create function pg_temp.live_rider(p_n text) returns uuid language sql as $$
  select rider_id from dispatch_offers where order_id = pg_temp.oid(p_n) and status = 'offered' $$;
create function pg_temp.cnt(p_n text, p_status text default null) returns bigint language sql as $$
  select count(*) from dispatch_offers where order_id = pg_temp.oid(p_n) and (p_status is null or status = p_status) $$;
create function pg_temp.ev(p_n text, p_event text) returns bigint language sql as $$
  select count(*) from dispatch_events where order_id = pg_temp.oid(p_n) and event = p_event $$;
create function pg_temp.make_due(p_n text) returns void language sql as $$
  update order_dispatch set next_check_at = now() - interval '1 second' where order_id = pg_temp.oid(p_n) $$;

create temp table res (k text primary key, v jsonb);
grant all on res to public;

-- The worker entry points a service-role caller can use.
create function pg_temp.tick() returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.authenticate_as_service_role();
  v := _dispatch_tick_run(200, 'test');
  reset role;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- 0. Grants and shape
-- ---------------------------------------------------------------------------

select ok(not has_function_privilege(r.role, f.sig, 'execute'), format('%s cannot execute %s', r.role, f.sig))
from (values ('dispatch_tick(integer)'), ('_dispatch_tick_run(integer, text)'), ('_dispatch_tick_order(uuid, text, timestamptz)'),
             ('_dispatch_tick_claim(integer)'), ('sweep_dispatch_offers()'), ('dispatch_orders_nearing_prep_completion()')) as f(sig)
cross join (values ('anon'), ('authenticated')) as r(role);

select ok(has_function_privilege('service_role', 'dispatch_tick(integer)', 'execute')
      and has_function_privilege('service_role', '_dispatch_tick_run(integer, text)', 'execute'), 'service_role can run the worker');

select is((select prokind::text || '/' || prosecdef::text || '/' || coalesce(array_to_string(proconfig, ','), '-') from pg_proc where proname = 'dispatch_tick'),
  'p/false/-', 'dispatch_tick is a PROCEDURE, SECURITY INVOKER, no SET clause (so it may COMMIT per order)');
select is((select prokind from pg_proc where proname = 'sweep_dispatch_offers'), 'f', 'sweep_dispatch_offers stays a function');

select tests.authenticate_as('dw_r1');
select throws_ok($$ select _dispatch_tick_run(10, 'x') $$, '42501', null, 'a rider cannot run the tick');
reset role;
select lives_ok($$ select * from _dispatch_tick_claim(10) $$, 'the claim is callable by the owner session');

-- ---------------------------------------------------------------------------
-- 1. The tick advances an expired offer to the next rider; lag is recorded
-- ---------------------------------------------------------------------------

select pg_temp.only('r1', 'r2');
select pg_temp.mk_order('01');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
values (pg_temp.oid('01'), pg_temp.uid('r1'), 'offered', 1, 1, now() - interval '2 minutes', now() - interval '1 minute');

insert into res select 't1', pg_temp.tick();

select is((select status || '/' || close_reason from dispatch_offers where order_id = pg_temp.oid('01') and rider_id = pg_temp.uid('r1')),
  'expired/timeout', 'tick: r1''s lapsed offer is expired (timeout)');
select is(pg_temp.live_rider('01'), pg_temp.uid('r2'), 'tick: r2 now holds the single live offer');
select is(pg_temp.cnt('01', 'offered'), 1::bigint, 'tick: still exactly one live offer');
select ok((select (v ->> 'offers_created')::int >= 1 and (v ->> 'processed')::int >= 1 and (v ->> 'errors')::int = 0 from res where k = 't1'),
  'tick: result counts the created offer, no errors');
select is(pg_temp.ev('01', 'tick_lag'), 1::bigint, 'tick: a 60 s late timer records a tick_lag event');
select ok((select (data ->> 'lag_ms')::numeric >= 59000 from dispatch_events where order_id = pg_temp.oid('01') and event = 'tick_lag'),
  'tick_lag carries the lag in ms');
select is((select state from order_dispatch where order_id = pg_temp.oid('01')), 'offered', 'tick: order_dispatch follows the new offer');

-- ---------------------------------------------------------------------------
-- 2. Duplicate tick in the same transaction creates nothing
-- ---------------------------------------------------------------------------

insert into res select 't2a', pg_temp.tick();
insert into res select 't2b', pg_temp.tick();
select is(pg_temp.cnt('01'), 2::bigint, 'duplicate ticks: order 01 still has exactly its two offers');
select is((select attempt_no from order_dispatch where order_id = pg_temp.oid('01')), 2, 'duplicate ticks: attempt_no unchanged');
select is(pg_temp.ev('01', 'offer_created'), 1::bigint, 'duplicate ticks: one offer_created event');
select is((select (v ->> 'offers_created')::int from res where k = 't2b'), 0, 'duplicate tick creates nothing');

-- ---------------------------------------------------------------------------
-- 3. Assigned and stopped orders are skipped
-- ---------------------------------------------------------------------------

select pg_temp.only('r3');
select pg_temp.mk_order('02', 'rider_assigned', 'r1');
insert into order_dispatch (order_id, state, cycle_no, attempt_no, next_check_at) values (pg_temp.oid('02'), 'assigned', 1, 1, now() - interval '5 minutes');
select pg_temp.mk_order('03');
insert into order_dispatch (order_id, state, cycle_no, attempt_no, next_check_at) values (pg_temp.oid('03'), 'stopped', 1, 1, now() - interval '5 minutes');

insert into res select 't3', pg_temp.tick();
select is(pg_temp.cnt('02') + pg_temp.cnt('03'), 0::bigint, 'assigned/stopped: no offers created (a free rider was online)');
select is((select count(*) from dispatch_events where order_id in (pg_temp.oid('02'), pg_temp.oid('03'))), 0::bigint, 'assigned/stopped: not even an event');
select is((select string_agg(state || '/' || attempt_no || '/' || error_count, ',' order by order_id) from order_dispatch
           where order_id in (pg_temp.oid('02'), pg_temp.oid('03'))), 'assigned/1/0,stopped/1/0', 'assigned/stopped: state rows untouched');

-- ---------------------------------------------------------------------------
-- 4. A stale timer does not touch a newer live offer
-- ---------------------------------------------------------------------------

select pg_temp.only('r1', 'r2');
select pg_temp.mk_order('04');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at, close_reason)
values (pg_temp.oid('04'), pg_temp.uid('r1'), 'expired', 1, 1, now() - interval '3 minutes', now() - interval '2 minutes', 'timeout');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
values (pg_temp.oid('04'), pg_temp.uid('r2'), 'offered', 1, 2, now(), now() + interval '40 seconds');
insert into order_dispatch (order_id, state, cycle_no, attempt_no, next_check_at) values (pg_temp.oid('04'), 'offered', 1, 2, now() - interval '1 second');

insert into res select 't4', pg_temp.tick();
select is(pg_temp.live_rider('04'), pg_temp.uid('r2'), 'stale timer: r2''s fresh offer is untouched and still live');
select is(pg_temp.cnt('04'), 2::bigint, 'stale timer: no new offer');
select is((select status from dispatch_offers where order_id = pg_temp.oid('04') and rider_id = pg_temp.uid('r1')), 'expired', 'stale timer: the old expired row is as it was');
select is((select next_check_at from order_dispatch where order_id = pg_temp.oid('04')),
  (select expires_at from dispatch_offers where order_id = pg_temp.oid('04') and status = 'offered'), 'stale timer: next_check_at re-pointed at the live offer expiry');
select is(pg_temp.ev('04', 'tick_lag'), 0::bigint, 'a 1 s late tick records no lag event (threshold 10 s)');

-- ---------------------------------------------------------------------------
-- 5. Error backoff, needs_attention after 5 failures, recovery on success
-- ---------------------------------------------------------------------------

select pg_temp.only('r2');  -- r1 holds an assigned order (02)
select pg_temp.mk_order('05');
create function pg_temp.dw_fail() returns trigger language plpgsql as $$
begin raise exception 'simulated failure'; end $$;
create trigger zz_dw_fail before insert on dispatch_offers
  for each row when (new.order_id = 'dd000000-0000-7000-8000-000000000405') execute function pg_temp.dw_fail();

insert into res select 't5a', pg_temp.tick();
select is((select error_count from order_dispatch where order_id = pg_temp.oid('05')), 1, 'failure 1: error_count 1 (state row created by the upsert)');
select ok((select last_error like '%simulated failure%' from order_dispatch where order_id = pg_temp.oid('05')), 'failure 1: last_error recorded');
select is((select next_check_at from order_dispatch where order_id = pg_temp.oid('05')), now() + interval '5 seconds', 'failure 1: retry in 5 s');
select is(pg_temp.cnt('05'), 0::bigint, 'failure 1: the failed advance left no offer behind');
select ok((select (v ->> 'errors')::int >= 1 from res where k = 't5a'), 'failure 1: counted in the tick result');

select is((select count(*) from _dispatch_tick_claim(200) where order_id = pg_temp.oid('05')), 0::bigint, 'backing off: not claimed again before its time');

select pg_temp.make_due('05');
insert into res select 't5b', pg_temp.tick();
select is((select error_count from order_dispatch where order_id = pg_temp.oid('05')), 2, 'failure 2: error_count 2');
select is((select next_check_at from order_dispatch where order_id = pg_temp.oid('05')), now() + interval '10 seconds', 'failure 2: retry in 10 s');
select pg_temp.make_due('05');
insert into res select 't5c', pg_temp.tick();
select pg_temp.make_due('05');
insert into res select 't5d', pg_temp.tick();
select is((select error_count from order_dispatch where order_id = pg_temp.oid('05')), 4, 'failure 4: error_count 4');
select is((select next_check_at from order_dispatch where order_id = pg_temp.oid('05')), now() + interval '40 seconds', 'failure 4: retry in 40 s');
select ok((select attention_reason is null from order_dispatch where order_id = pg_temp.oid('05')), 'failure 4: not yet needs_attention');
select pg_temp.make_due('05');
insert into res select 't5e', pg_temp.tick();
select is((select state || '/' || attention_reason from order_dispatch where order_id = pg_temp.oid('05')), 'needs_attention/worker_errors',
  'failure 5: needs_attention (worker_errors)');
select ok((select needs_attention_since is not null from order_dispatch where order_id = pg_temp.oid('05')), 'failure 5: needs_attention_since stamped');
select is(pg_temp.ev('05', 'tick_error'), 5::bigint, 'five tick_error events');
select is(pg_temp.ev('05', 'needs_attention'), 1::bigint, 'one needs_attention event');
select pg_temp.make_due('05');
insert into res select 't5f', pg_temp.tick();
select is(pg_temp.ev('05', 'needs_attention'), 1::bigint, 'failure 6: no second needs_attention event');
select is((select error_count from order_dispatch where order_id = pg_temp.oid('05')), 6, 'failure 6: counting continues');
select ok((select next_check_at <= now() + interval '300 seconds' from order_dispatch where order_id = pg_temp.oid('05')), 'backoff is capped at 300 s');

drop trigger zz_dw_fail on dispatch_offers;
select pg_temp.make_due('05');
insert into res select 't5g', pg_temp.tick();
select is(pg_temp.live_rider('05'), pg_temp.uid('r2'), 'recovery: the next tick after the fault is gone offers r2');
select is((select error_count || '/' || coalesce(last_error, '-') || '/' || coalesce(attention_reason, '-') from order_dispatch where order_id = pg_temp.oid('05')),
  '0/-/-', 'recovery: error_count reset, worker_errors alert cleared');
select is((select state from order_dispatch where order_id = pg_temp.oid('05')), 'offered', 'recovery: state back to offered');

-- ---------------------------------------------------------------------------
-- 6. Recovery of an order with no order_dispatch row; 30-minute give-up
-- ---------------------------------------------------------------------------

select pg_temp.only('r3');
select pg_temp.mk_order('06');
select is((select count(*) from order_dispatch where order_id = pg_temp.oid('06')), 0::bigint, 'recovery: the order has no state row');
select is((select count(*) from _dispatch_tick_claim(200) where order_id = pg_temp.oid('06')), 1::bigint, 'recovery: the claim finds it');
insert into res select 't6', pg_temp.tick();
select is(pg_temp.live_rider('06'), pg_temp.uid('r3'), 'recovery: the tick offered it to the free rider');
select is((select state from order_dispatch where order_id = pg_temp.oid('06')), 'offered', 'recovery: order_dispatch row now exists');

-- ---------------------------------------------------------------------------
-- 7. Outbox row on offer insert (made by the tick in section 6 for order 06)
-- ---------------------------------------------------------------------------

select is((select count(*) from message_outbox where dedupe_key = 'offer:' || (select id from dispatch_offers where order_id = pg_temp.oid('06') and status = 'offered') || ':push'),
  1::bigint, 'outbox: one push row for the offer');
create temp table pr as
  select m.* from message_outbox m where m.dedupe_key = 'offer:' || (select id from dispatch_offers where order_id = pg_temp.oid('06') and status = 'offered') || ':push';
select is((select channel || '/' || category || '/' || kind || '/' || status || '/' || recipient_user_id::text from pr),
  'push/transactional/rider_offer/queued/' || pg_temp.uid('r3'), 'outbox: push, transactional, rider_offer, queued, addressed to the rider');
select ok((select to_address is null and subject = 'New delivery' from pr), 'outbox: no stored address (tokens are resolved at send time)');
select is((select expires_at from pr), (select expires_at from dispatch_offers where order_id = pg_temp.oid('06') and status = 'offered'), 'outbox: expires with the offer');
select is((select data from pr),
  (select jsonb_build_object('type', 'dispatch_offer', 'orderId', order_id, 'offerId', id) from dispatch_offers where order_id = pg_temp.oid('06') and status = 'offered'),
  'outbox: data = {type, orderId, offerId}');
select is((select body from pr), 'Pickup from DW Bakery. Tap to see it.', 'outbox: body names the vendor only');
select ok((select (body || ' ' || coalesce(subject, '') || ' ' || data::text) !~* ('(secret|2348019999|close|' || (select code from orders where id = pg_temp.oid('06')) || ')') from pr),
  'outbox: no customer name, phone, address or order code anywhere in the row');
select throws_ok(format($$ insert into message_outbox (kind, channel, category, recipient_user_id, body, dedupe_key) values ('rider_offer', 'push', 'transactional', %L, 'x', %L) $$,
    pg_temp.uid('r3'), (select dedupe_key from pr)), '23505', null, 'outbox: the dedupe key makes a second push for the offer impossible');
select throws_ok(format($$ insert into message_outbox (kind, channel, category, recipient_user_id, body) values ('direct', 'push', 'promotional', %L, 'x') $$,
    pg_temp.uid('r3')), '23514', null, 'outbox: a push can never be promotional');
select ok((select has_table_privilege('authenticated', 'message_outbox', 'select') = false), 'outbox: not readable by authenticated');

-- 30-minute give-up (no rider online at all)
select pg_temp.only('r3');
select pg_temp.mk_order('07', 'ready_for_pickup', null, '31 minutes');
update riders set is_online = false;
insert into res select 't6b', pg_temp.tick();
select is((select status::text from orders where id = pg_temp.oid('07')), 'cancelled_by_platform', 'give-up: ready order unclaimed for 31 minutes is cancelled by the tick');
select ok((select (v ->> 'orders_cancelled')::int >= 1 from res where k = 't6b'), 'give-up: counted in the tick result');

-- ---------------------------------------------------------------------------
-- 8. SMS with several rows per rider/order and the new statuses; withdrawn push; suppression
-- ---------------------------------------------------------------------------

select pg_temp.only('r1', 'r2');
select pg_temp.mk_order('09');
select pg_temp.mk_order('10');
-- Order 09: three rows for the same (order, rider): expired, cancelled and the live one.
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at, close_reason) values
  (pg_temp.oid('09'), pg_temp.uid('r2'), 'expired', 1, 1, now() - interval '5 minutes', now() - interval '4 minutes', 'timeout'),
  (pg_temp.oid('09'), pg_temp.uid('r2'), 'cancelled', 1, 2, now() - interval '3 minutes', now() - interval '2 minutes', 'rider_unavailable');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
values (pg_temp.oid('09'), pg_temp.uid('r2'), 'offered', 1, 3, now() - interval '20 seconds', now() + interval '40 seconds');
-- Order 10: a fresh offer (0 s old) is not texted yet.
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
values (pg_temp.oid('10'), pg_temp.uid('r1'), 'offered', 1, 1, now(), now() + interval '45 seconds');
-- Six push rows already sent to this rider in the last hour must not eat the SMS cap (6).
insert into message_outbox (kind, channel, category, recipient_user_id, body, status, dedupe_key)
select 'rider_offer', 'push', 'transactional', pg_temp.uid('r2'), 'old', 'sent', 'dw:old-push:' || g from generate_series(1, 6) g;

select tests.authenticate_as_service_role();
insert into res select 's1', to_jsonb(enqueue_rider_offer_sms());
reset role;
select is((select count(*) from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':sms' where d.order_id = pg_temp.oid('09')),
  1::bigint, 'sms: exactly one SMS for the one live offer despite three rows for (order, rider)');
select is((select m.status from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':sms' where d.order_id = pg_temp.oid('09')),
  'queued', 'sms: queued after 12 s (the six old push rows did not consume the cap)');
select is((select count(*) from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':sms' where d.order_id = pg_temp.oid('10')),
  0::bigint, 'sms: a fresh offer is not texted yet');
select ok((select body like 'KiaKia: new delivery from DW Bakery%' and body !~* '(secret|2348019999|close)' from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':sms' where d.order_id = pg_temp.oid('09')),
  'sms: vendor name only, no customer data');
select is((select count(*) from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':sms' where d.order_id = pg_temp.oid('09') and m.to_address is not null), 1::bigint,
  'sms: still addressed to the rider''s phone');

-- Close the live offer of order 09 as superseded after its push was handed to the worker.
update message_outbox set status = 'sent', sent_at = now()
where dedupe_key = 'offer:' || (select id from dispatch_offers where order_id = pg_temp.oid('09') and status = 'offered') || ':push';
select _dispatch_close_live_offer(pg_temp.oid('09'), 'superseded', 'order_assigned');
select is((select m.status || '/' || m.suppress_reason from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':sms' where d.order_id = pg_temp.oid('09') and d.attempt_no = 3),
  'suppressed/expired', 'closing: the still-queued SMS is suppressed (expired)');
select is((select count(*) from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':withdrawn' where d.order_id = pg_temp.oid('09')),
  1::bigint, 'closing: a pushed rider gets one "no longer available" push');
select is((select m.channel || '/' || m.category || '/' || m.status || '/' || (m.data ->> 'type') from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':withdrawn' where d.order_id = pg_temp.oid('09')),
  'push/transactional/queued/dispatch_offer_withdrawn', 'closing: withdrawn push is a queued transactional push of type dispatch_offer_withdrawn');
select is((select m.data from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':withdrawn' where d.order_id = pg_temp.oid('09')),
  (select jsonb_build_object('type', 'dispatch_offer_withdrawn', 'orderId', order_id, 'offerId', id) from dispatch_offers where order_id = pg_temp.oid('09') and attempt_no = 3),
  'closing: withdrawn data = {type, orderId, offerId}');
select ok((select m.expires_at <= now() + interval '2 minutes' and m.recipient_user_id = pg_temp.uid('r2') from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':withdrawn' where d.order_id = pg_temp.oid('09')),
  'closing: withdrawn push goes to the same rider and lapses in 2 minutes');
select is((select count(*) from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':push' where d.order_id = pg_temp.oid('09') and d.attempt_no = 3 and m.status = 'sent'),
  1::bigint, 'closing: the already-sent push row is left alone');

-- A push still queued when the offer closes is suppressed and no withdrawn push is sent.
select _dispatch_close_live_offer(pg_temp.oid('10'), 'cancelled', 'rider_unavailable');
select is((select m.status || '/' || m.suppress_reason from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':push' where d.order_id = pg_temp.oid('10')),
  'suppressed/expired', 'closing: a still-queued push is suppressed (expired)');
select is((select count(*) from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':withdrawn' where d.order_id = pg_temp.oid('10')),
  0::bigint, 'closing: no withdrawn push when the rider was never pushed');

-- Plain status changes via the guard trigger path: a decline suppresses too, a replay does nothing.
select pg_temp.mk_order('11');
insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, offered_at, expires_at)
values (pg_temp.oid('11'), pg_temp.uid('r3'), 'offered', 1, 1, now(), now() + interval '45 seconds');
update dispatch_offers set status = 'declined' where order_id = pg_temp.oid('11');
select is((select m.status from message_outbox m join dispatch_offers d on m.dedupe_key = 'offer:' || d.id || ':push' where d.order_id = pg_temp.oid('11')),
  'suppressed', 'a declined offer''s queued push is suppressed too');

-- The worker's claim ignores suppressed rows and takes a queued push like any transactional row.
insert into message_outbox (kind, channel, category, recipient_user_id, body, data, dedupe_key)
values ('rider_offer', 'push', 'transactional', pg_temp.uid('r1'), 'claim me', '{"type":"dispatch_offer"}', 'dw:claim-push');
select tests.authenticate_as_service_role();
create temp table claimed as select * from message_claim_batch(100);
reset role;
select ok(exists (select 1 from claimed where dedupe_key = 'dw:claim-push' and channel = 'push' and status = 'sending' and attempts = 1),
  'worker claim: a queued push row is claimed (sending, attempts 1)');
select ok(not exists (select 1 from claimed where status <> 'sending'), 'worker claim: only sending rows come back');
select tests.authenticate_as_service_role();
select is(message_mark_suppressed((select id from claimed where dedupe_key = 'dw:claim-push'), 'no_push_token'), true, 'mark_suppressed accepts no_push_token');
reset role;
select is((select status || '/' || suppress_reason from message_outbox where dedupe_key = 'dw:claim-push'), 'suppressed/no_push_token', 'a push without tokens ends suppressed/no_push_token (not failed)');

-- ---------------------------------------------------------------------------
-- 9. Legacy wrappers keep their shapes
-- ---------------------------------------------------------------------------

select tests.authenticate_as_service_role();
create temp table sw as select * from sweep_dispatch_offers();
create temp table ep as select * from dispatch_orders_nearing_prep_completion();
reset role;
select is((select count(*) from sw), 1::bigint, 'sweep_dispatch_offers() returns its one row (offers_expired, offers_created, orders_cancelled)');
select ok((select offers_expired is not null and offers_created is not null and orders_cancelled is not null from sw), 'sweep columns are filled');
select is((select count(*) from ep), 1::bigint, 'dispatch_orders_nearing_prep_completion() returns its one row (offers_created)');
select tests.authenticate_as('dw_r1');
select throws_ok($$ select * from sweep_dispatch_offers() $$, '42501', null, 'sweep: a rider is refused');
reset role;
select throws_like($$ select * from dispatch_orders_nearing_prep_completion() $$, '%requires the service-role key%', 'early dispatch: no role, no entry');

-- ---------------------------------------------------------------------------
-- 10. Cron
-- ---------------------------------------------------------------------------

select is((select array_agg(jobname order by jobname) from cron.job),
  array['dispatch-tick', 'enqueue-rider-offer-sms', 'message-worker-tick', 'prune-cron-run-details', 'purge-customer-events',
        'purge-dispatch-events', 'purge-rider-offer-responses', 'scrub-message-outbox'], 'cron: the job set');
select is((select schedule || ' | ' || command from cron.job where jobname = 'dispatch-tick'), '5 seconds | call dispatch_tick();',
  'cron: dispatch-tick every 5 s as a single CALL');
select is((select count(*) from cron.job where jobname in ('sweep-dispatch-offers', 'dispatch-orders-nearing-prep-completion')), 0::bigint, 'cron: the two old dispatch jobs are gone');
select is((select schedule from cron.job where jobname = 'purge-dispatch-events'), '37 3 * * *', 'cron: dispatch_events retention daily');
select ok((select command like '%rider_offer_responses%1 hour%' and schedule = '11 * * * *' from cron.job where jobname = 'purge-rider-offer-responses'), 'cron: rider_offer_responses purged hourly');
select is((select schedule from cron.job where jobname = 'enqueue-rider-offer-sms') || '/' || (select schedule from cron.job where jobname = 'message-worker-tick'),
  '15 seconds/10 seconds', 'cron: SMS fallback and message worker unchanged');
select is(_ensure_scheduled_jobs(), true, 'cron: _ensure_scheduled_jobs() is idempotent');
select is((select count(*) from cron.job), 8::bigint, 'cron: still eight jobs');

select * from finish();
rollback;
