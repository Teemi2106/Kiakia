-- Add the vendor's order contact number to the customer's authorized
-- tracking snapshot. `vendors` has no public phone column; the store
-- owner's contact lives in profiles, whose RLS intentionally allows only
-- the owner to read it directly. Keep this behind get_order_tracking's
-- existing order-customer/vendor-staff/admin authorization check.

drop function if exists get_order_tracking(uuid);

create function public.get_order_tracking(p_order_id uuid)
returns table (
  status text,
  vendor_lat double precision,
  vendor_lng double precision,
  destination_lat double precision,
  destination_lng double precision,
  rider_lat double precision,
  rider_lng double precision,
  rider_updated_at timestamptz,
  rider_name text,
  rider_phone text,
  rider_vehicle_type text,
  rider_plate_number text,
  delivery_by text,
  vendor_name text,
  vendor_phone text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_vendor vendors;
  v_rider order_rider_locations;
  v_rider_profile profiles;
  v_rider_row riders;
  v_vendor_profile profiles;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'get_order_tracking: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

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
  select * into v_vendor_profile from profiles where id = v_vendor.owner_user_id;
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
    v_rider_row.plate_number,
    v_order.delivery_by,
    v_vendor.name,
    v_vendor_profile.phone;
end;
$$;

revoke execute on function public.get_order_tracking(uuid) from public, anon;
grant execute on function public.get_order_tracking(uuid) to authenticated, service_role;

comment on function public.get_order_tracking(uuid) is
  'Authorized order tracking snapshot: status and delivery coordinates, assigned rider contact/vehicle, delivery mode, vendor name, and vendor owner contact phone. Only the order customer, its vendor staff, or an admin may read it. Profile phone data is returned only through this SECURITY DEFINER function because profiles are own-row-only under RLS.';
