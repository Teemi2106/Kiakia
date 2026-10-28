-- KiaKia - 0111: bring _dispatch_rider_counts to the final 0098 revision on
-- databases that applied an earlier revision of 0098.
--
-- Hosted holds the first revision, which counted riders with correlated
-- subqueries (profile lookup, "has an active order") per rider. The final 0098
-- revision is set based (busy riders computed once, anti-joined) and returns the
-- same numbers; it matters for cost only, because the dispatch engine and
-- admin_dispatch_status() call this function for every searching order. Found by
-- the post-deploy body comparison of 0099-0109. `create or replace` keeps the
-- existing grants (service_role/authenticated cannot call it directly).

create or replace function _dispatch_rider_counts(p_order_id uuid, p_radius_m integer)
returns table (online_riders integer, eligible_riders integer, in_range_riders integer, fundable_riders integer, nearest_online_m integer)
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
  r as (
    select st_distance(rd.current_location, o.vloc) as d,
           (rd.last_ping_at >= now() - make_interval(secs => params.max_age)
            and p.status = 'active'
            and b.rider_id is null) as avail,
           o.base_fee, o.per_km, o.max_fee, o.distance_m,
           (p_radius_m is null or st_dwithin(rd.current_location, o.vloc, p_radius_m)) as in_range
    from riders rd
    cross join o
    cross join params
    left join profiles p on p.id = rd.user_id
    left join busy b on b.rider_id = rd.user_id
    where rd.is_online and rd.kyc_status = 'approved' and rd.current_location is not null and o.vloc is not null
  )
  select count(*)::integer,
         (count(*) filter (where avail))::integer,
         (count(*) filter (where avail and in_range))::integer,
         (count(*) filter (where avail and in_range and base_fee is not null
                           and base_fee + per_km * ceil((d + coalesce(distance_m, 0)) / 1000.0)::bigint <= max_fee))::integer,
         round(min(d))::integer
  from r
$$;
