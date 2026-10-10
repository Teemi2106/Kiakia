-- KiaKia - fixes a live bug found while manually testing the rider app's
-- offer flow end to end: every call to get_rider_offer_details() fails with
-- "column reference \"status\" is ambiguous", so no rider has ever been able
-- to successfully view a dispatch offer's details on this function's
-- current definition.
--
-- Root cause: `returns table (..., status text, ...)` makes `status` an
-- implicit PL/pgSQL variable inside the function body, in addition to it
-- being a real column on dispatch_offers. 0044 introduced (and 0057
-- reproduced byte for byte, since its only intended change to this function
-- was the unrelated expires_at check) an authorization query that references
-- `status` unqualified:
--
--   select 1 from dispatch_offers
--   where order_id = p_order_id
--     and rider_id = auth.uid()
--     and (status = 'accepted' or (status = 'offered' and expires_at > now()))
--
-- Postgres's default plpgsql.variable_conflict = error setting refuses to
-- silently guess between the OUT-parameter variable and the table column
-- here, so it raises instead. Fix: qualify every dispatch_offers column
-- reference in that clause with the table name. Nothing else about this
-- function changes - `create or replace function` reproduces 0057's
-- definition byte for byte except for that one qualification, same
-- convention 0057 itself used relative to 0044/0050.
--
-- Never edit 0044 or 0057 directly - both already shipped. This is applied
-- on top, per this repo's established convention (see 0050's own header).

create or replace function get_rider_offer_details(p_order_id uuid)
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
  rider_fee_estimate_kobo bigint
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
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'get_rider_offer_details: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if auth.uid() is null then
    raise exception 'get_rider_offer_details: no authenticated caller';
  end if;

  -- Fixed here: dispatch_offers.status and dispatch_offers.expires_at are now
  -- qualified. Unqualified `status` collided with this function's own
  -- `status` OUT parameter and made the query fail outright for every
  -- caller - see this migration's header.
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

  -- Best-effort live estimate. Left NULL (never raised) whenever any input
  -- it needs is missing - the caller's own current_location, the vendor's
  -- location, or the order's service area rates - since this is advisory
  -- only. Unchanged from 0044/0057.
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
    v_rider_fee_estimate;
end;
$$;

comment on function get_rider_offer_details(uuid) is
  'Lets a rider see what a dispatch offer is FOR before deciding whether to accept it, and lets the assigned rider re-read the same details afterward. Deliberately NOT `returns orders` - see 0032''s own header for why. Also returns pickup_distance_m/rider_fee_estimate_kobo (0044): a live, non-authoritative estimate of what accepting would pay, NULL whenever the rider''s own location, the vendor''s location, or the order''s service area rates are missing (never raises for this part - it is advisory only). Authorization: a live ''accepted'' dispatch_offers row (no expiry check - the assigned rider must keep reading this for the whole trip), OR a live ''offered'' row that has NOT yet passed expires_at (0057 - an expired, never-accepted offer no longer grants access), OR already being the assigned rider via orders.rider_id. Re-checked on every call. 0058 fixed a `column reference "status" is ambiguous` error present in both 0044 and 0057''s definitions by qualifying dispatch_offers.status/expires_at in the authorization query - unqualified `status` collided with this function''s own `status` OUT parameter under plpgsql.variable_conflict = error, so every single call to this function failed until this fix.';

revoke execute on function get_rider_offer_details(uuid) from public;
grant execute on function get_rider_offer_details(uuid) to authenticated;
