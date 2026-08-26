-- KiaKia — the missing rider backend surface, part 2/3: get_order_tracking(),
-- the single RPC that gives the customer's live-tracking map its initial
-- state (vendor location, delivery destination, last-known rider position,
-- current order status) in one round trip. Live UPDATES after this initial
-- read come from the Realtime subscriptions on `orders` /
-- `order_rider_locations` wired up in 0026_rider_self_service.sql.
--
-- This function's return shape is a locked contract — a parallel
-- frontend-dev pass is building the tracking page against it. Do not rename
-- or reorder columns without coordinating that change.

create or replace function get_order_tracking(p_order_id uuid)
returns table (
  status            text,
  vendor_lat        double precision,
  vendor_lng        double precision,
  destination_lat   double precision,
  destination_lng   double precision,
  rider_lat         double precision,
  rider_lng         double precision,
  rider_updated_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  orders;
  v_vendor vendors;
  v_rider  order_rider_locations;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'get_order_tracking: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- Authorized to: the order's own customer, its vendor's staff, or an
  -- admin/superadmin. Nobody else — in particular NOT every rider (only the
  -- assigned one would ever legitimately need this, and the assigned rider
  -- already gets position data by being the one calling
  -- update_rider_location() in the first place, not by reading this back).
  if auth.uid() is distinct from v_order.customer_id
    and not exists (
      select 1 from vendor_staff where vendor_id = v_order.vendor_id and user_id = auth.uid()
    )
    and not exists (
      select 1 from user_roles where user_id = auth.uid() and role in ('admin', 'superadmin')
    )
  then
    raise exception 'get_order_tracking: actor % is not authorized to view order %', auth.uid(), p_order_id;
  end if;

  select * into v_vendor from vendors where id = v_order.vendor_id;
  select * into v_rider from order_rider_locations where order_id = p_order_id;

  -- st_y()/st_x() — NOT WKB, NOT a GeoJSON string — per this function's
  -- locked contract. Both take `geometry`, not `geography` (PostGIS has no
  -- direct geography overload), hence the explicit ::geometry cast; casting
  -- a NULL geography (vendors.location is nullable — 0003_catalog.sql) still
  -- yields NULL all the way through, never a fabricated coordinate.
  return query
  select
    v_order.status::text,
    st_y(v_vendor.location::geometry),
    st_x(v_vendor.location::geometry),
    st_y(v_order.delivery_location::geometry),
    st_x(v_order.delivery_location::geometry),
    v_rider.lat,
    v_rider.lng,
    v_rider.updated_at;
end;
$$;

comment on function get_order_tracking(uuid) is
  'The tracking map''s initial-state read: order status, vendor/destination/rider coordinates as plain lat/lng floats (never WKB/GeoJSON), rider_* is NULL until a rider is assigned and pinging (order_rider_locations, 0026). Authorized to the order''s customer, its vendor''s staff, or an admin — raises otherwise. Live updates after this initial call ride the orders / order_rider_locations Realtime publication (0026), not repeated calls to this function.';

revoke execute on function get_order_tracking(uuid) from public;
grant execute on function get_order_tracking(uuid) to authenticated;
