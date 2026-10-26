-- Benchmark: H3 candidate discovery (0099-0101) vs the PostGIS GiST KNN query (0098),
-- at synthetic rider scale. Reproducible, read-only in effect: EVERYTHING runs inside
-- ONE transaction that ends in ROLLBACK, so no synthetic row is ever committed.
--
-- Run ONLY against a throwaway local database (never hosted), once per size:
--   for n in 5000 20000 50000; do
--     docker exec -i supabase_db_kiakia-admintest psql -U postgres -d postgres \
--       -v ON_ERROR_STOP=1 -v n=$n -v orders=200 -v adv=20 -f - < supabase/tests/h3/bench-discovery.sql
--   done
-- (adv = how many of the orders get the full _dispatch_advance runs c1-c3, which are slow:
-- seconds per call in the c2 empty-ring case; the discovery methods a/b always use all orders.)
-- (any ERROR aborts psql and the open transaction rolls back with the connection.)
--
-- Geography: Ibadan box lat 7.25-7.55, lng 3.75-4.05; 60% of riders/vendors drawn from a
-- ~N(centre 7.40, 3.90; sd 0.06 deg ~ 6.6 km) blob, 40% uniform over the box. setseed makes
-- the data identical across runs. ~70% of riders online with fresh pings (0-120 s);
-- kyc approved 85% / pending 10% / rejected 5%; profile active 95% / suspended 5%.
--
-- Output: one result table per size (median / p95 ms per method) plus plans.

\set ON_ERROR_STOP on
\timing off
\pset pager off
begin;
select setseed(0.42);
select set_config('bench.n', :'n', true), set_config('bench.orders', :'orders', true), set_config('bench.adv', :'adv', true);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
create temp table res (method text, n int, ms double precision, note text);
create temp table setup_t (step text, ms double precision);
create temp table bo (id uuid primary key, vloc geography, ord serial);

create function pg_temp.rnd_lat() returns double precision language sql volatile as $$
  select least(7.55, greatest(7.25, case when random() < 0.6
    then 7.40 + (random() + random() + random() - 1.5) * 2 * 0.06
    else 7.25 + random() * 0.30 end)) $$;
create function pg_temp.rnd_lng() returns double precision language sql volatile as $$
  select least(4.05, greatest(3.75, case when random() < 0.6
    then 3.90 + (random() + random() + random() - 1.5) * 2 * 0.06
    else 3.75 + random() * 0.30 end)) $$;

do $$
declare t0 timestamptz; n int := current_setting('bench.n')::int; n_ord int := current_setting('bench.orders')::int;
begin
  -- 1. users (+ profiles through on_auth_user_created)
  t0 := clock_timestamp();
  insert into auth.users (id, aud, role, email)
  select gen_random_uuid(), 'authenticated', 'authenticated', 'bench' || g || '@bench.invalid'
  from generate_series(1, n + 1) g;
  insert into setup_t values ('auth.users + profiles insert', extract(epoch from clock_timestamp() - t0) * 1000);

  update profiles set status = 'suspended'
  where id in (select id from auth.users where email like 'bench%@bench.invalid' and random() < 0.05);

  -- 2. riders WITHOUT the h3 trigger, then the backfill (the migration's UPDATE) timed separately
  alter table riders disable trigger riders_set_h3_cell;
  t0 := clock_timestamp();
  insert into riders (user_id, is_online, kyc_status, current_location, last_ping_at)
  select u.id, o.online,
         case when random() < 0.85 then 'approved' when random() < 0.67 then 'pending' else 'rejected' end,
         st_setsrid(st_makepoint(pg_temp.rnd_lng(), pg_temp.rnd_lat()), 4326)::geography,
         now() - random() * interval '120 seconds'
  from (select id, row_number() over () rn from auth.users where email like 'bench%@bench.invalid') u
  cross join lateral (select random() < 0.70 as online) o
  where u.rn > 1;
  insert into setup_t values ('riders bulk insert (trigger disabled)', extract(epoch from clock_timestamp() - t0) * 1000);

  t0 := clock_timestamp();
  update riders set h3_cell = h3_latlng_to_cell(st_y(current_location::geometry), st_x(current_location::geometry), 9)
  where h3_cell is null and current_location is not null;
  insert into setup_t values ('h3_cell backfill UPDATE (all synthetic riders)', extract(epoch from clock_timestamp() - t0) * 1000);
  alter table riders enable trigger riders_set_h3_cell;

  -- 3. service area, vendors, one ready+paid order per vendor
  insert into service_areas (id, name, polygon, is_active, base_delivery_fee_kobo, per_km_fee_kobo, rider_base_fee_kobo, rider_per_km_fee_kobo)
  values ('ee000000-0000-7000-8000-0000000b3001', 'Bench Ibadan',
          st_geogfromtext('POLYGON((3.70 7.20, 4.10 7.20, 4.10 7.60, 3.70 7.60, 3.70 7.20))'), true, 50000, 15000, 50000, 15000);
  insert into vendors (id, owner_user_id, service_area_id, name, slug, status, location, commission_bps, delivery_radius_m, avg_prep_mins)
  select gen_random_uuid(), (select id from auth.users where email like 'bench%@bench.invalid' order by id limit 1),
         'ee000000-0000-7000-8000-0000000b3001', 'Bench V' || g, 'bench-v-' || g, 'active',
         st_setsrid(st_makepoint(pg_temp.rnd_lng(), pg_temp.rnd_lat()), 4326)::geography, 1500, 20000, 20
  from generate_series(1, n_ord) g;
  insert into orders (id, customer_id, vendor_id, service_area_id, status, payment_status, subtotal_kobo, delivery_fee_kobo, service_fee_kobo,
                      discount_kobo, total_kobo, delivery_address, delivery_location, ready_at, accepted_at, first_dispatched_at, delivery_by, distance_m)
  select gen_random_uuid(), (select id from auth.users where email like 'bench%@bench.invalid' order by id limit 1),
         v.id, 'ee000000-0000-7000-8000-0000000b3001', 'ready_for_pickup', 'paid', 5000000, 50000, 100000, 0, 5150000,
         '{"line1": "1 Bench St"}'::jsonb, st_geogfromtext('POINT(3.90 7.40)'), now(), now(), now(), 'rider', 2000
  from vendors v where v.slug like 'bench-v-%';
  -- inserting orders may have started dispatch rows/offers; start every method from a clean slate
  delete from dispatch_offers;
  delete from order_dispatch;
  insert into bo (id, vloc) select o.id, v.location from orders o join vendors v on v.id = o.vendor_id where v.slug like 'bench-v-%';
end $$;

analyze riders; analyze vendors; analyze orders; analyze profiles;

-- ---------------------------------------------------------------------------
-- Harness
-- ---------------------------------------------------------------------------
-- p_sql takes $1 = vendor location (geography), $2 = order id. 1 warm-up pass, 1 measured pass.
create function pg_temp.bench(p_method text, p_sql text) returns void language plpgsql as $$
declare r record; t0 timestamptz; ms double precision; pass int; v bigint;
begin
  for pass in 1..2 loop
    for r in select id, vloc from bo order by ord loop
      t0 := clock_timestamp();
      execute 'select count(*) from (' || p_sql || ') q' into v using r.vloc, r.id;
      ms := extract(epoch from clock_timestamp() - t0) * 1000;
      if pass = 2 then insert into res values (p_method, current_setting('bench.n')::int, ms, v::text); end if;
    end loop;
  end loop;
end $$;

-- advance: not repeatable (it writes), so one measured pass only.
create function pg_temp.bench_adv(p_method text) returns void language plpgsql as $$
declare r record; t0 timestamptz; ms double precision; o jsonb;
begin
  for r in select id from bo order by ord limit current_setting('bench.adv')::int loop
    t0 := clock_timestamp();
    o := _dispatch_advance(r.id, 'bench', false);
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    insert into res values (p_method, current_setting('bench.n')::int, ms, o ->> 'outcome');
  end loop;
end $$;

create function pg_temp.knn_sql(p_limit int) returns text language sql as $$
  select format($q$
    select r.user_id
    from riders r join profiles p on p.id = r.user_id
    where r.is_online and r.kyc_status = 'approved' and r.current_location is not null
      and r.last_ping_at >= now() - interval '300 seconds' and p.status = 'active'
      and not exists (select 1 from orders o where o.rider_id = r.user_id
                      and o.status in ('accepted','preparing','rider_assigned','picked_up','in_transit','arrived'))
      and not exists (select 1 from dispatch_offers d where d.rider_id = r.user_id and d.status = 'offered' and d.expires_at > now())
    order by r.current_location <-> $1
    limit %s $q$, p_limit) $$;

create function pg_temp.disk_sql(p_k int, p_join boolean) returns text language sql as $$
  select format($q$
    with disk as materialized (select d.cell, d.k from h3_grid_disk_distances(
           h3_latlng_to_cell(st_y($1::geometry), st_x($1::geometry), 8), %s) d),
    ranges as materialized (select d.k, g.lo, g.hi from disk d cross join lateral h3_cell_to_descendant_range(d.cell, 9) g)
    %s $q$, p_k,
    case when p_join then 'select r.user_id from ranges rg join riders r on r.h3_cell between rg.lo and rg.hi'
         else 'select * from ranges' end) $$;

-- (a) GiST KNN, inline 0098-style filters
select pg_temp.bench('a1 KNN inline nearest 10', pg_temp.knn_sql(10));
select pg_temp.bench('a2 KNN inline nearest 1', pg_temp.knn_sql(1));
-- (a') the engine's own fallback branch (ring null), with fee/exclusion/available helpers
select pg_temp.bench('a3 _dispatch_candidates beyond_rings limit 10', 'select * from _dispatch_candidates($2, null, null, 1, 10)');
select pg_temp.bench('a4 _dispatch_candidates beyond_rings limit 1', 'select * from _dispatch_candidates($2, null, null, 1, 1)');
-- (b) H3
select pg_temp.bench('b0 disk only k=1 (no rider join)', pg_temp.disk_sql(1, false));
select pg_temp.bench('b0 disk only k=4 (no rider join)', pg_temp.disk_sql(4, false));
select pg_temp.bench('b0 disk only k=8 (no rider join)', pg_temp.disk_sql(8, false));
select pg_temp.bench('b1 disk+range join k=1 (raw, no filters)', pg_temp.disk_sql(1, true));
select pg_temp.bench('b1 disk+range join k=4 (raw, no filters)', pg_temp.disk_sql(4, true));
select pg_temp.bench('b1 disk+range join k=8 (raw, no filters)', pg_temp.disk_sql(8, true));
select pg_temp.bench('b2 _dispatch_candidates ring 1 limit 5', 'select * from _dispatch_candidates($2, 1, null, 1, 5)');
select pg_temp.bench('b2 _dispatch_candidates ring 4 limit 5', 'select * from _dispatch_candidates($2, 4, null, 1, 5)');
select pg_temp.bench('b2 _dispatch_candidates ring 8 limit 5', 'select * from _dispatch_candidates($2, 8, null, 1, 5)');

-- (c) whole _dispatch_advance
select pg_temp.bench_adv('c1 _dispatch_advance, H3 path');
-- H3 finds nobody (h3_cell cleared): ring 1..8 all empty, then KNN fallback
delete from dispatch_offers; delete from order_dispatch;
update riders set h3_cell = null;
select pg_temp.bench_adv('c2 _dispatch_advance, H3 empty -> KNN fallback');
-- KNN-dominated baseline: rings collapsed to ring 0..1 (h3_cell still null from c2, so both are empty), then KNN
delete from dispatch_offers; delete from order_dispatch;
update platform_settings set value_int = case key when 'dispatch_h3_initial_ring' then 0 else 1 end
 where key in ('dispatch_h3_initial_ring', 'dispatch_h3_max_ring');  -- max_ring floor is 1
select pg_temp.bench_adv('c3 _dispatch_advance, rings 0-1 empty -> KNN (approx pure KNN)');

-- ---------------------------------------------------------------------------
-- Per-ping trigger cost: 5000 moving pings, trigger on vs off (same rows, GiST+btree maintained)
-- ---------------------------------------------------------------------------
do $$
declare t0 timestamptz; ids uuid[];
begin
  update platform_settings set value_int = case key when 'dispatch_h3_initial_ring' then 1 else 8 end
   where key in ('dispatch_h3_initial_ring', 'dispatch_h3_max_ring');
  update riders set h3_cell = h3_latlng_to_cell(st_y(current_location::geometry), st_x(current_location::geometry), 9);
  select array_agg(user_id) into ids from (select user_id from riders order by user_id limit 5000) s;
  alter table riders disable trigger riders_set_h3_cell;
  t0 := clock_timestamp();
  update riders set current_location = st_setsrid(st_makepoint(st_x(current_location::geometry) + 0.0003, st_y(current_location::geometry)), 4326)::geography
  where user_id = any(ids);
  insert into setup_t values ('5000 moving pings, trigger OFF (total ms)', extract(epoch from clock_timestamp() - t0) * 1000);
  alter table riders enable trigger riders_set_h3_cell;
  t0 := clock_timestamp();
  update riders set current_location = st_setsrid(st_makepoint(st_x(current_location::geometry) + 0.0003, st_y(current_location::geometry)), 4326)::geography
  where user_id = any(ids);
  insert into setup_t values ('5000 moving pings, trigger ON (total ms)', extract(epoch from clock_timestamp() - t0) * 1000);
end $$;

-- ---------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------
select :'n' as riders;
select step, round(ms::numeric, 1) as ms from setup_t order by 1;
select method,
       round((percentile_cont(0.5) within group (order by ms))::numeric, 3) as median_ms,
       round((percentile_cont(0.95) within group (order by ms))::numeric, 3) as p95_ms,
       count(*) as calls,
       case when method like 'b%' or method like 'a%' then round(avg(case when note ~ '^[0-9]+$' then note::numeric end), 1)::text
            else string_agg(distinct note, ',') end as avg_rows_or_outcome
from res group by method order by method;

-- ---------------------------------------------------------------------------
-- Plans (central vendor)
-- ---------------------------------------------------------------------------
\echo '--- PLAN: GiST KNN, nearest 10 ---'
select set_config('bench.vloc', st_astext(vloc::geometry), true) from bo order by ord limit 1;
explain (analyze, buffers off, costs off, timing on)
select r.user_id from riders r join profiles p on p.id = r.user_id
where r.is_online and r.kyc_status = 'approved' and r.current_location is not null
  and r.last_ping_at >= now() - interval '300 seconds' and p.status = 'active'
  and not exists (select 1 from orders o where o.rider_id = r.user_id
                  and o.status in ('accepted','preparing','rider_assigned','picked_up','in_transit','arrived'))
  and not exists (select 1 from dispatch_offers d where d.rider_id = r.user_id and d.status = 'offered' and d.expires_at > now())
order by r.current_location <-> st_geogfromtext('POINT(3.90 7.40)')
limit 10;

\echo '--- PLAN: H3 disk-range join, k=4 at the centre (the pool query shape, filters as the engine) ---'
explain (analyze, buffers off, costs off, timing on)
with disk as materialized (select d.cell, d.k from h3_grid_disk_distances(h3_latlng_to_cell(7.40, 3.90, 8), 4) d),
ranges as materialized (select d.k, g.lo, g.hi from disk d cross join lateral h3_cell_to_descendant_range(d.cell, 9) g)
select r.user_id from ranges rg join riders r on r.h3_cell between rg.lo and rg.hi
where r.is_online and _dispatch_rider_available(r.user_id);

rollback;
