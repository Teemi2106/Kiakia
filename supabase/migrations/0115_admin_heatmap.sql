-- KiaKia - platform-wide heatmap for admins.
--
-- fleet_demand_cells() (0113) is scoped to a fleet and hides thin areas. Admins
-- need the whole picture: demand everywhere, every online rider, and no cutoff.
--
-- Read-only, service_role only. Like the other admin read RPCs there is no actor
-- argument: the app gates the page with requireAdminContext() and these are
-- unreachable to every other role. Same ~550 m grid as the fleet heatmap.

-- Where orders are being placed, across the whole platform.
create function admin_demand_cells(p_hours integer default 3, p_min_orders integer default 1)
returns table (lat double precision, lng double precision, orders bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  c_grid constant double precision := 0.005;
begin
  perform _message_assert_service('admin_demand_cells');
  if p_hours is null or p_hours not between 1 and 72 then
    raise exception 'admin_demand_cells: hours must be 1-72' using errcode = 'check_violation';
  end if;
  if p_min_orders is null or p_min_orders not between 1 and 100 then
    raise exception 'admin_demand_cells: min orders must be 1-100' using errcode = 'check_violation';
  end if;

  return query
  select (g.cy + 0.5) * c_grid, (g.cx + 0.5) * c_grid, g.n
  from (
    select floor(st_y(o.delivery_location::geometry) / c_grid) as cy,
           floor(st_x(o.delivery_location::geometry) / c_grid) as cx,
           count(*) as n
    from orders o
    where o.placed_at >= now() - make_interval(hours => p_hours)
      and o.status not in ('draft', 'rejected_by_vendor', 'cancelled_by_customer', 'cancelled_by_platform')
    group by 1, 2
    having count(*) >= p_min_orders
    order by count(*) desc
    limit 2000
  ) g;
end;
$$;

comment on function admin_demand_cells(integer, integer) is
  'Order demand on a ~550 m grid over the last p_hours (1-72), platform wide, cells under p_min_orders hidden (default 1 = nothing hidden), at most 2000 cells. service_role only.';

revoke execute on function admin_demand_cells(integer, integer) from public, anon, authenticated;
grant execute on function admin_demand_cells(integer, integer) to service_role;

-- Every rider whose online switch is on and who has a position, with their fleet.
create function admin_live_riders()
returns table (
  user_id      uuid,
  full_name    text,
  lat          double precision,
  lng          double precision,
  is_live      boolean,
  on_delivery  boolean,
  fleet_name   text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_max_age integer;
begin
  perform _message_assert_service('admin_live_riders');
  v_max_age := _platform_setting_int('dispatch_location_max_age_seconds')::integer;

  return query
  select r.user_id,
         coalesce(nullif(btrim(pr.full_name), ''), 'Rider'),
         st_y(r.current_location::geometry),
         st_x(r.current_location::geometry),
         coalesce(r.last_ping_at >= now() - make_interval(secs => v_max_age), false),
         exists (
           select 1 from orders x
           where x.rider_id = r.user_id and x.status in ('rider_assigned', 'picked_up', 'in_transit', 'arrived')
         ),
         f.name
  from riders r
  join profiles pr on pr.id = r.user_id
  left join fleets f on f.id = r.fleet_id
  where r.is_online and r.current_location is not null
  order by r.last_ping_at desc nulls last
  limit 2000;
end;
$$;

comment on function admin_live_riders() is
  'Online riders with a position (name, live/stale, whether on a delivery, fleet name), newest ping first, at most 2000. service_role only.';

revoke execute on function admin_live_riders() from public, anon, authenticated;
grant execute on function admin_live_riders() to service_role;
