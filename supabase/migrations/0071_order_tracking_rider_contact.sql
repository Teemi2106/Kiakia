-- KiaKia - the customer's live tracking map and the vendor's order detail
-- page both show a rider position/status once one is assigned, but neither
-- has ever surfaced WHO that rider is - no name, no phone number. Product
-- decision: once a rider is assigned, both the customer and the vendor
-- staff on that order should be able to identify and, if needed, call them
-- - the same two audiences get_order_tracking() (0029) already authorizes
-- for the coordinate data.
--
-- Extends get_order_tracking()'s return shape with rider_name/rider_phone,
-- appended at the end rather than inserted among the existing columns -
-- that function's own header calls its return shape "a locked contract...
-- do not rename or reorder columns" - so this only adds to it, every
-- existing column keeps its name, type, and position. Postgres still
-- requires `drop function` first regardless (OUT-parameter shape changed,
-- same reasoning 0067_dispatch_cycle_and_30min_giveup.sql hit for
-- sweep_dispatch_offers() - SQLSTATE 42P13, "cannot change return type of
-- existing function").
--
-- Sourced from profiles (full_name/phone) and riders (vehicle_type/
-- plate_number) - every account's identity, rider or not, lives in
-- profiles (0002_identity.sql), keyed 1:1 with auth.users.id, which is
-- also riders.user_id.
--
-- WHY THIS HAS TO GO THROUGH A SECURITY DEFINER FUNCTION, NOT A DIRECT
-- QUERY: both tables' only SELECT policy (0007_rls.sql) is strictly
-- own-row - `profiles`: "read own profile" using (id = auth.uid());
-- `riders`: "read own rider row", same shape. A customer or vendor-staff
-- session querying `profiles`/`riders` directly for the ASSIGNED RIDER's
-- row (auth.uid() is neither of those) gets zero rows back, silently - no
-- error, just an empty result RLS is working exactly as designed to
-- produce. apps/web's own tracking page.tsx was already written as if this
-- worked (`riderProfile?.full_name`), which is how this went unnoticed:
-- the code path executes, returns no data, and the page's own "omit rather
-- than fabricate" convention (this file's own doc comment: "no rating, no
-- live location") quietly hides the entire driver card as "no rider yet"
-- even once one genuinely is assigned. See apps/web's own follow-up
-- commit (same session) that replaces that broken direct query with a
-- call to this function - now the single source of truth for rider
-- contact info, same as it already is for rider position.
--
-- NULL, not an error, until a rider is actually assigned (orders.rider_id
-- is null) - same posture the existing rider_lat/rider_lng/rider_updated_at
-- columns already have for "no rider yet".

drop function if exists get_order_tracking(uuid);

create function get_order_tracking(p_order_id uuid)
returns table (
  status            text,
  vendor_lat        double precision,
  vendor_lng        double precision,
  destination_lat   double precision,
  destination_lng   double precision,
  rider_lat         double precision,
  rider_lng         double precision,
  rider_updated_at  timestamptz,
  rider_name          text,
  rider_phone         text,
  rider_vehicle_type  text,
  rider_plate_number  text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  orders;
  v_vendor vendors;
  v_rider  order_rider_locations;
  v_rider_profile profiles;
  v_rider_row riders;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'get_order_tracking: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- Authorization unchanged from 0029: the order's own customer, its
  -- vendor's staff, or an admin/superadmin.
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

  if v_order.rider_id is not null then
    select * into v_rider_profile from profiles where id = v_order.rider_id;
    select * into v_rider_row from riders where user_id = v_order.rider_id;
  end if;

  return query
  select
    v_order.status::text,
    st_y(v_vendor.location::geometry),
    st_x(v_vendor.location::geometry),
    st_y(v_order.delivery_location::geometry),
    st_x(v_order.delivery_location::geometry),
    v_rider.lat,
    v_rider.lng,
    v_rider.updated_at,
    v_rider_profile.full_name,
    v_rider_profile.phone,
    v_rider_row.vehicle_type,
    v_rider_row.plate_number;
end;
$$;

comment on function get_order_tracking(uuid) is
  'The tracking map''s initial-state read: order status, vendor/destination/rider coordinates as plain lat/lng floats (never WKB/GeoJSON), rider_* is NULL until a rider is assigned and pinging (order_rider_locations, 0026). rider_name/rider_phone/rider_vehicle_type/rider_plate_number (0071) are NULL until orders.rider_id is set, sourced from profiles + riders - both tables are own-row-only under RLS (0007_rls.sql), so this SECURITY DEFINER read is the only way a customer or vendor-staff session can ever see the ASSIGNED rider''s contact info; a direct query from either session returns nothing, silently, no matter how it is written. Authorized to the order''s customer, its vendor''s staff, or an admin - raises otherwise. Live updates after this initial call ride the orders / order_rider_locations Realtime publication (0026), not repeated calls to this function.';

revoke execute on function get_order_tracking(uuid) from public;
grant execute on function get_order_tracking(uuid) to authenticated;
