-- KiaKia - the rider-facing offer/assignment read (get_rider_offer_details,
-- last touched 0058) has never returned the customer's name or phone
-- number at all - a rider can see the delivery address and note, but has
-- no way to actually reach the person they're delivering to. Same gap
-- 0071_order_tracking_rider_contact.sql closed in the other direction
-- (customer/vendor seeing the RIDER's contact info); this closes it for
-- the rider seeing the CUSTOMER's.
--
-- Sourced from profiles.phone/full_name, keyed on orders.customer_id -
-- same SECURITY DEFINER reasoning as 0071: `profiles` is own-row-only under
-- RLS (0007_rls.sql), so a rider session querying it directly for the
-- customer's row would silently get nothing back no matter how the query
-- was written. This function already runs SECURITY DEFINER and already
-- authorizes the caller explicitly (a live offer or the actual assignment,
-- unchanged below) - appending two more profiles-sourced columns costs
-- nothing new on the trust-boundary front.
--
-- profiles.phone is now required at checkout (apps/web's placeOrderAction,
-- same commit) precisely so this column stops being frequently null the
-- way it has been since the 0014 regression 0070 just fixed - but it can
-- still be null for an order placed before that change, so this returns
-- NULL rather than raising either way.
--
-- Appended at the end of the return shape, not inserted among the
-- existing columns - matches 0071's own reasoning for get_order_tracking()
-- and 0058's still-relevant warning about this exact function: its `status`
-- OUT parameter has already collided with an unqualified table column once
-- (0058) and cost every rider a broken offer screen until caught. Postgres
-- still requires `drop function` first (OUT-parameter shape changed, same
-- SQLSTATE 42P13 reasoning as 0067/0071).

drop function if exists get_rider_offer_details(uuid);

create function get_rider_offer_details(p_order_id uuid)
returns table (
  order_code              text,
  status                  text,
  vendor_name             text,
  vendor_address_line     text,
  vendor_landmark         text,
  pickup_lat              double precision,
  pickup_lng              double precision,
  dropoff_lat             double precision,
  dropoff_lng             double precision,
  delivery_address        jsonb,
  delivery_note           text,
  item_count              integer,
  total_kobo              bigint,
  delivery_fee_kobo       bigint,
  distance_m              integer,
  pickup_distance_m       integer,
  rider_fee_estimate_kobo bigint,
  customer_name           text,
  customer_phone          text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order              orders;
  v_vendor             vendors;
  v_rider_location     geography(point, 4326);
  v_area               service_areas;
  v_pickup_distance_m  double precision;
  v_rider_fee_estimate bigint;
  v_customer_profile   profiles;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'get_rider_offer_details: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if auth.uid() is null then
    raise exception 'get_rider_offer_details: no authenticated caller';
  end if;

  -- Authorization unchanged from 0058 - every dispatch_offers.*
  -- reference already qualified there, reproduced byte for byte.
  if not exists (
    select 1 from dispatch_offers
    where order_id = p_order_id
      and rider_id = auth.uid()
      and (
        dispatch_offers.status = 'accepted'
        or (dispatch_offers.status = 'offered' and dispatch_offers.expires_at > now())
      )
  ) and auth.uid() is distinct from v_order.rider_id then
    raise exception 'get_rider_offer_details: actor % has no active offer or assignment on order %', auth.uid(), p_order_id;
  end if;

  select * into v_vendor from vendors where id = v_order.vendor_id;
  select * into v_customer_profile from profiles where id = v_order.customer_id;

  -- Best-effort live estimate, unchanged from 0044/0057/0058.
  select current_location into v_rider_location from riders where user_id = auth.uid();

  if v_rider_location is not null and v_vendor.location is not null and v_order.service_area_id is not null then
    select * into v_area from service_areas where id = v_order.service_area_id;
    if found then
      v_pickup_distance_m := st_distance(v_rider_location, v_vendor.location);
      v_rider_fee_estimate := v_area.rider_base_fee_kobo
        + v_area.rider_per_km_fee_kobo * ceil((v_pickup_distance_m + coalesce(v_order.distance_m, 0)) / 1000.0)::bigint;
    end if;
  end if;

  return query
  select
    v_order.code,
    v_order.status::text,
    v_vendor.name,
    v_vendor.address_line,
    v_vendor.landmark,
    st_y(v_vendor.location::geometry),
    st_x(v_vendor.location::geometry),
    st_y(v_order.delivery_location::geometry),
    st_x(v_order.delivery_location::geometry),
    v_order.delivery_address,
    v_order.delivery_note,
    (select coalesce(sum(qty), 0)::integer from order_items where order_id = v_order.id),
    v_order.total_kobo,
    v_order.delivery_fee_kobo,
    v_order.distance_m,
    round(v_pickup_distance_m)::integer,
    v_rider_fee_estimate,
    v_customer_profile.full_name,
    v_customer_profile.phone;
end;
$$;

comment on function get_rider_offer_details(uuid) is
  'Lets a rider see what a dispatch offer is FOR before deciding whether to accept it, and lets the assigned rider re-read the same details afterward. Deliberately NOT `returns orders` - see 0032''s own header for why. Also returns pickup_distance_m/rider_fee_estimate_kobo (0044) and customer_name/customer_phone (0072) - the latter sourced from profiles (own-row-only under RLS, so this SECURITY DEFINER read is the only way a rider ever sees it), NULL only for an order placed before profiles.phone became required at checkout. Authorization: a live ''accepted'' dispatch_offers row (no expiry check - the assigned rider must keep reading this for the whole trip), OR a live ''offered'' row that has NOT yet passed expires_at (0057), OR already being the assigned rider via orders.rider_id. Re-checked on every call. 0058 fixed a `column reference "status" is ambiguous` error present in both 0044 and 0057''s definitions by qualifying dispatch_offers.status/expires_at in the authorization query.';

revoke execute on function get_rider_offer_details(uuid) from public;
grant execute on function get_rider_offer_details(uuid) to authenticated;
