-- KiaKia - 0110: ship the 0098 rider-funnel helper to databases that applied an
-- earlier revision of 0098.
--
-- 0098 was edited after it had already been applied to the hosted project, so
-- hosted never received _dispatch_rider_funnel(uuid, integer, integer). From 0102
-- on, admin_dispatch_status() calls it, and on hosted that call failed with
-- "function _dispatch_rider_funnel(uuid, integer, integer) does not exist"
-- (found by the post-deploy check of 0099-0109). This migration creates the
-- function exactly as 0098 defines it. `create or replace` makes it a no-op
-- semantically on any database that already has it (local, fresh replays).
-- Read-only, internal, no grants (service_role/authenticated cannot call it
-- directly; admin_dispatch_status() is SECURITY DEFINER and can).

-- NOTE both funnels need `params` and `o` MATERIALIZED: _platform_setting_int()
-- and _max_rider_fee_kobo() are functions the planner cannot inline, and an
-- inlined CTE would call them once per rider (~1 s per order at 5000 riders).
--
-- The same funnel at TWO radii in one pass (distance computed once per rider),
-- for admin_dispatch_status() which shows the base and the store radius.
create or replace function _dispatch_rider_funnel(p_order_id uuid, p_radius1_m integer, p_radius2_m integer)
returns table (online_riders integer, eligible_riders integer,
               in_range1 integer, fundable1 integer, in_range2 integer, fundable2 integer, nearest_online_m integer)
language sql
stable
security definer
set search_path = public
as $$
  with params as materialized (
    select _platform_setting_int('dispatch_location_max_age_seconds')::integer as max_age
  ),
  o as materialized (
    select ord.id, ord.distance_m, v.location as vloc, sa.rider_base_fee_kobo as base_fee, sa.rider_per_km_fee_kobo as per_km,
           _max_rider_fee_kobo(ord.id) as max_fee
    from orders ord
    join vendors v on v.id = ord.vendor_id
    left join service_areas sa on sa.id = ord.service_area_id
    where ord.id = p_order_id
  ),
  busy as (
    select distinct x.rider_id
    from orders x
    where x.rider_id is not null
      and x.status in ('accepted', 'preparing', 'rider_assigned', 'picked_up', 'in_transit', 'arrived')
  ),
  -- Distances use the sphere (use_spheroid = false): ~10x cheaper than the
  -- spheroid the offer query uses and within ~0.5% of it - plenty for a
  -- diagnostic funnel, which must stay fast with thousands of riders online.
  r0 as (
    select st_distance(rd.current_location, o.vloc, false) as d,
           (rd.last_ping_at >= now() - make_interval(secs => params.max_age)
            and p.status = 'active'
            and b.rider_id is null) as avail,
           o.base_fee, o.per_km, o.max_fee, o.distance_m
    from riders rd
    cross join o
    cross join params
    left join profiles p on p.id = rd.user_id
    left join busy b on b.rider_id = rd.user_id
    where rd.is_online and rd.kyc_status = 'approved' and rd.current_location is not null and o.vloc is not null
  ),
  r as (
    select d, avail, base_fee is not null as priced,
           base_fee + per_km * ceil((d + coalesce(distance_m, 0)) / 1000.0)::bigint <= max_fee as fundable
    from r0
  )
  select count(*)::integer,
         (count(*) filter (where avail))::integer,
         (count(*) filter (where avail and (p_radius1_m is null or d <= p_radius1_m)))::integer,
         (count(*) filter (where avail and (p_radius1_m is null or d <= p_radius1_m) and priced and fundable))::integer,
         (count(*) filter (where avail and (p_radius2_m is null or d <= p_radius2_m)))::integer,
         (count(*) filter (where avail and (p_radius2_m is null or d <= p_radius2_m) and priced and fundable))::integer,
         round(min(d))::integer
  from r
$$;

comment on function _dispatch_rider_funnel(uuid, integer, integer) is
  'Rider funnel for one order at two radii (null = no cap) in one pass: online, available, available within radius 1 / radius 2, of those payable by the order, and the nearest online rider in metres. O(online riders) per call; used by admin_dispatch_status(). Internal; read-only.';

revoke all on function _dispatch_rider_funnel(uuid, integer, integer) from public, anon, authenticated, service_role;
