-- pgTAP: rider lock follow-ups (0107).
--
-- (1) Wake-up when a rider is assigned to another order: the order where that rider
--     still holds a live offer gets next_check_at = now(), and the next tick cancels
--     the dead offer ('rider_unavailable') and offers the next rider.
-- (2) Wake-up when the rider goes offline (set_rider_online(false)): same.
-- (3) _dispatch_advance on an order cancelled while it held a rider ends 'stopped',
--     not 'assigned'.
-- The candidate-lock race itself (two ticks, one shared rider) needs two sessions and
-- is proven by supabase/tests/concurrency scenario 8.1 and its hard invariant.
--
-- Geometry as dispatch_worker.sql: vendor at POINT(7.5 9.5); riders east of it.

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
-- 1. Rider assigned elsewhere -> the other order is woken and re-offers
-- ---------------------------------------------------------------------------

select pg_temp.only('r1');
select pg_temp.mk_order('11');
select pg_temp.mk_order('12');
select _dispatch_tick_order(pg_temp.oid('11'), 'tick', now());
select is(pg_temp.live_rider('11'), pg_temp.uid('r1'), 'wake1: r1 holds the live offer on order 11');
update order_dispatch set next_check_at = now() + interval '1 hour' where order_id = pg_temp.oid('11');

update orders set rider_id = pg_temp.uid('r1'), status = 'rider_assigned' where id = pg_temp.oid('12');
select ok((select next_check_at <= now() from order_dispatch where order_id = pg_temp.oid('11')),
  'wake1: assigning r1 to order 12 makes order 11 due immediately');
select is((select state from order_dispatch where order_id = pg_temp.oid('12')), 'assigned', 'wake1: the assigned order is not touched (stays assigned)');

update riders set is_online = true, last_ping_at = now() where user_id = pg_temp.uid('r2');
insert into res select 'w1', pg_temp.tick();
select is((select status || '/' || close_reason from dispatch_offers where order_id = pg_temp.oid('11') and rider_id = pg_temp.uid('r1')),
  'cancelled/rider_unavailable', 'wake1: the tick cancels r1''s dead offer (rider_unavailable)');
select is(pg_temp.live_rider('11'), pg_temp.uid('r2'), 'wake1: r2 is offered order 11 at once');

-- no wake-up for an order where the rider holds no live offer
select pg_temp.only('r2');
select pg_temp.mk_order('13');
select pg_temp.mk_order('14');
select _dispatch_tick_order(pg_temp.oid('13'), 'tick', now());
update order_dispatch set next_check_at = now() + interval '1 hour' where order_id = pg_temp.oid('13');
update orders set rider_id = pg_temp.uid('r3'), status = 'rider_assigned' where id = pg_temp.oid('14');
select ok((select next_check_at > now() from order_dispatch where order_id = pg_temp.oid('13')),
  'wake1: assigning a rider who holds no offer on order 13 leaves its timer alone');

-- ---------------------------------------------------------------------------
-- 2. Rider goes offline -> the order holding the live offer is woken
-- ---------------------------------------------------------------------------

update orders set status = 'cancelled_by_platform' where id = pg_temp.oid('12');   -- frees r1
select pg_temp.only('r2');
select pg_temp.mk_order('21');
select _dispatch_tick_order(pg_temp.oid('21'), 'tick', now());
select is(pg_temp.live_rider('21'), pg_temp.uid('r2'), 'wake2: r2 holds the live offer on order 21');
update order_dispatch set next_check_at = now() + interval '1 hour' where order_id = pg_temp.oid('21');

select tests.authenticate_as('dw_r2');
select set_rider_online(false);
reset role;
select ok((select next_check_at <= now() from order_dispatch where order_id = pg_temp.oid('21')),
  'wake2: set_rider_online(false) makes the order due immediately');

update riders set is_online = true, last_ping_at = now() where user_id = pg_temp.uid('r1');
insert into res select 'w2', pg_temp.tick();
select is((select status || '/' || close_reason from dispatch_offers where order_id = pg_temp.oid('21') and rider_id = pg_temp.uid('r2')),
  'cancelled/rider_unavailable', 'wake2: the tick cancels the offline rider''s offer');
select is(pg_temp.live_rider('21'), pg_temp.uid('r1'), 'wake2: the next rider is offered');

-- going ONLINE (or a location ping) wakes nothing
update order_dispatch set next_check_at = now() + interval '1 hour' where order_id = pg_temp.oid('21');
select tests.authenticate_as('dw_r2');
select set_rider_online(true);
reset role;
select ok((select next_check_at > now() from order_dispatch where order_id = pg_temp.oid('21')), 'wake2: going online does not wake anything');

-- ---------------------------------------------------------------------------
-- 3. Finding 2: a cancelled order that kept its rider ends 'stopped'
-- ---------------------------------------------------------------------------

select pg_temp.only('r1');
select pg_temp.mk_order('31', 'rider_assigned', 'r1');
update orders set status = 'cancelled_by_platform' where id = pg_temp.oid('31');
update order_dispatch set state = 'offered' where order_id = pg_temp.oid('31');
select is(_dispatch_advance(pg_temp.oid('31'), 'tick') ->> 'reason', 'order_closed', 'closed: advance reports order_closed (not assigned)');
select is((select state from order_dispatch where order_id = pg_temp.oid('31')), 'stopped', 'closed: state is stopped, not assigned');

-- an assigned, still-open order stays 'assigned'
select pg_temp.mk_order('32', 'rider_assigned', 'r1');
select is(_dispatch_advance(pg_temp.oid('32'), 'tick') ->> 'reason', 'assigned', 'closed: an open assigned order is still assigned');

select * from finish();
rollback;
