-- KiaKia - removes the free-delivery-above-threshold mechanism entirely,
-- per a deliberate pricing decision made after reviewing the platform's
-- margin model: service_areas.free_above_kobo let a large enough order
-- zero out delivery_fee_kobo for the customer while the rider was still
-- paid their FULL distance-based fee (0044_rider_fee_by_distance.sql's own
-- header already flagged this asymmetry). With nothing tying the threshold
-- to typical rider-fee cost for that service area, and no cap on how far a
-- waived-fee order's dropoff could be, this could - and on at least one
-- real test order, did - push the platform's residual share
-- (verify_delivery_and_release_escrow()'s v_platform_kobo) close to zero
-- or negative, the latter of which trips that function's own safety check
-- and fails the escrow release outright rather than merely being
-- unprofitable.
--
-- Also worth recording plainly: no vendor ever had a way to set this -
-- free_above_kobo lives on service_areas, not vendors, and nothing in
-- apps/web ever read or wrote it. It was a platform-level, admin-only
-- (in practice, direct-SQL-only) setting from the day it shipped.
--
-- Fix: place_order() always charges the full base + per-km delivery fee,
-- unconditionally. The column is dropped rather than merely left unread -
-- a column that still exists but does nothing is a footgun for whoever
-- next reaches for it assuming it still works, same reasoning
-- 0022_delivery_code_off_orders.sql gave for dropping orders.delivery_code
-- outright instead of leaving it as inert dead weight.
--
-- place_order() is otherwise byte-for-byte unchanged from
-- 0022_delivery_code_off_orders.sql's definition - only the free-delivery
-- branch is removed. Never edit 0022 directly; it already shipped.

create or replace function place_order(
  p_cart_id           uuid,
  p_delivery_address  jsonb,
  p_delivery_location geography(point, 4326),
  p_delivery_note     text default null
)
returns orders
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cart               carts;
  v_vendor              vendors;
  v_area                service_areas;
  v_distance_m          double precision;
  v_subtotal_kobo       bigint;
  v_delivery_fee_kobo   bigint;
  v_service_fee_kobo    bigint;
  v_total_kobo          bigint;
  v_order               orders;
begin
  select * into v_cart from carts where id = p_cart_id for update;
  if not found then
    raise exception 'place_order: cart % does not exist', p_cart_id;
  end if;
  if v_cart.customer_id is distinct from auth.uid() then
    raise exception 'place_order: cart % does not belong to the caller', p_cart_id;
  end if;
  if v_cart.status <> 'open' then
    raise exception 'place_order: cart % is not open (status=%)', p_cart_id, v_cart.status;
  end if;
  if v_cart.vendor_id is null then
    raise exception 'place_order: cart % has no vendor set (empty cart)', p_cart_id;
  end if;

  select * into v_vendor from vendors where id = v_cart.vendor_id;
  if not found or v_vendor.status <> 'active' or not v_vendor.is_accepting_orders then
    raise exception 'place_order: vendor is not currently accepting orders';
  end if;
  if v_vendor.location is null then
    raise exception 'place_order: vendor has no location set, cannot compute delivery distance';
  end if;

  select * into v_area
  from service_areas
  where is_active and st_contains(polygon::geometry, p_delivery_location::geometry)
  limit 1;

  if not found then
    raise exception 'place_order: delivery address is outside every active service area'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from cart_items where cart_id = p_cart_id) then
    raise exception 'place_order: cart % has no items', p_cart_id;
  end if;

  if exists (
    select 1
    from cart_items ci
    where ci.cart_id = p_cart_id
      and not exists (
        select 1 from menu_items mi
        where mi.id = ci.menu_item_id
          and mi.vendor_id = v_cart.vendor_id
          and mi.is_available
      )
  ) then
    raise exception 'place_order: cart % has an item that is no longer available from this vendor', p_cart_id
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from cart_items ci
    cross join lateral jsonb_array_elements(ci.options_snapshot) elem
    where ci.cart_id = p_cart_id
      and not exists (
        select 1
        from options o
        join option_groups og on og.id = o.group_id
        where o.id = (elem ->> 'optionId')::uuid
          and og.menu_item_id = ci.menu_item_id
          and o.is_available
      )
  ) then
    raise exception 'place_order: cart % has an option that is no longer available for its item', p_cart_id
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(
    (mi.price_kobo + coalesce((
      select sum(o.price_delta_kobo)
      from jsonb_array_elements(ci.options_snapshot) elem
      join options o on o.id = (elem ->> 'optionId')::uuid
      join option_groups og on og.id = o.group_id and og.menu_item_id = ci.menu_item_id
      where o.is_available
    ), 0)) * ci.qty
  ), 0)
  into v_subtotal_kobo
  from cart_items ci
  join menu_items mi on mi.id = ci.menu_item_id and mi.vendor_id = v_cart.vendor_id and mi.is_available
  where ci.cart_id = p_cart_id;

  if v_subtotal_kobo < v_vendor.min_order_kobo then
    raise exception 'place_order: subtotal % kobo is below vendor %''s minimum order of % kobo',
      v_subtotal_kobo, v_vendor.id, v_vendor.min_order_kobo
      using errcode = 'check_violation';
  end if;

  v_distance_m := st_distance(v_vendor.location, p_delivery_location);

  -- Always charged. No free-delivery waiver any more - see this
  -- migration's header for why.
  v_delivery_fee_kobo := v_area.base_delivery_fee_kobo + v_area.per_km_fee_kobo * ceil(v_distance_m / 1000.0)::bigint;

  v_service_fee_kobo := round(v_subtotal_kobo * 200 / 10000.0); -- SERVICE_FEE_BPS = 200
  v_total_kobo := v_subtotal_kobo + v_delivery_fee_kobo + v_service_fee_kobo;

  insert into orders (
    customer_id, vendor_id, service_area_id, subtotal_kobo, delivery_fee_kobo,
    service_fee_kobo, discount_kobo, total_kobo, delivery_address,
    delivery_location, delivery_note, distance_m
  ) values (
    auth.uid(), v_cart.vendor_id, v_area.id, v_subtotal_kobo, v_delivery_fee_kobo,
    v_service_fee_kobo, 0, v_total_kobo, p_delivery_address,
    p_delivery_location, p_delivery_note, round(v_distance_m)
  )
  returning * into v_order;

  insert into order_delivery_codes (order_id, code)
  values (
    v_order.id,
    lpad((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 10000)::text, 4, '0')
  );

  insert into order_items (order_id, menu_item_id, name_snapshot, unit_price_kobo, qty, options_snapshot, line_total_kobo)
  select
    v_order.id,
    ci.menu_item_id,
    mi.name,
    mi.price_kobo + coalesce((
      select sum(o.price_delta_kobo)
      from jsonb_array_elements(ci.options_snapshot) elem
      join options o on o.id = (elem ->> 'optionId')::uuid
      join option_groups og on og.id = o.group_id and og.menu_item_id = ci.menu_item_id
      where o.is_available
    ), 0),
    ci.qty,
    ci.options_snapshot,
    (mi.price_kobo + coalesce((
      select sum(o.price_delta_kobo)
      from jsonb_array_elements(ci.options_snapshot) elem
      join options o on o.id = (elem ->> 'optionId')::uuid
      join option_groups og on og.id = o.group_id and og.menu_item_id = ci.menu_item_id
      where o.is_available
    ), 0)) * ci.qty
  from cart_items ci
  join menu_items mi on mi.id = ci.menu_item_id and mi.vendor_id = v_cart.vendor_id and mi.is_available
  where ci.cart_id = p_cart_id;

  update carts set status = 'converted' where id = p_cart_id;

  return v_order;
end;
$$;

comment on function place_order(uuid, jsonb, geography, text) is
  'The only writer of the orders/order_items INSERT path, and of order_delivery_codes. Mirrors packages/domain/src/delivery.ts - keep both in sync. Pricing joins are vendor/menu-item-scoped and min_order_kobo is enforced server-side - see 0016_fix_place_order_pricing_scope.sql. The delivery code is written to order_delivery_codes, never to orders - see 0022_delivery_code_off_orders.sql. Delivery fee is always charged in full - see 0062_remove_free_delivery_threshold.sql for why the free-delivery waiver was removed.';

revoke execute on function place_order(uuid, jsonb, geography, text) from public;
grant execute on function place_order(uuid, jsonb, geography, text) to authenticated;

-- ---------------------------------------------------------------------------
-- service_areas.free_above_kobo - dropped, not merely left unread. See this
-- migration's header.
-- ---------------------------------------------------------------------------

alter table service_areas drop column free_above_kobo;
