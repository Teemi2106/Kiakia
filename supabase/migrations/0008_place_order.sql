-- KiaKia — place_order(): the only writer of the `orders`/`order_items`
-- INSERT path, mirroring how transition_order() is the only writer of
-- orders.status (§10). Called directly by the customer (grant to
-- authenticated) — authorization is `auth.uid()` equality, checked inline,
-- same pattern as transition_order()'s actor checks.
--
-- Fee formula mirrors packages/domain/src/delivery.ts exactly — keep both
-- in sync. SERVICE_FEE_BPS (200 = 2%) is a placeholder rate, not a
-- documented product decision — see that file's header comment.
--
-- Prices are re-derived from LIVE menu_items/options data, never trusted
-- from cart_items' own stored unit_price_kobo — a customer can write
-- arbitrary values into their own cart_items via RLS (§9's "client-owned
-- scratch state"), so the cart is a shopping list here, not a price source.
-- This is the "never trust the client, recompute server-side" rule from
-- §12 applied one layer deeper than the order-total computation itself.

create or replace function place_order(
  p_cart_id           uuid,
  p_delivery_address  jsonb,
  p_delivery_location geography(point, 4326),
  p_delivery_note     text default null
)
returns orders
language plpgsql
security definer
set search_path = public
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
  -- Lock the cart and verify ownership/state.
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

  -- Delivery address must fall inside an active service area.
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

  -- Re-derive the subtotal from live menu_items/options prices.
  select coalesce(sum(
    (mi.price_kobo + coalesce((
      select sum(o.price_delta_kobo)
      from jsonb_array_elements(ci.options_snapshot) elem
      join options o on o.id = (elem ->> 'optionId')::uuid
    ), 0)) * ci.qty
  ), 0)
  into v_subtotal_kobo
  from cart_items ci
  join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = p_cart_id;

  -- Fees — mirrors packages/domain/src/delivery.ts's computeDeliveryFee/computeServiceFee.
  v_distance_m := st_distance(v_vendor.location, p_delivery_location);

  if v_area.free_above_kobo is not null and v_subtotal_kobo >= v_area.free_above_kobo then
    v_delivery_fee_kobo := 0;
  else
    v_delivery_fee_kobo := v_area.base_delivery_fee_kobo + v_area.per_km_fee_kobo * ceil(v_distance_m / 1000.0)::bigint;
  end if;

  v_service_fee_kobo := round(v_subtotal_kobo * 200 / 10000.0); -- SERVICE_FEE_BPS = 200
  v_total_kobo := v_subtotal_kobo + v_delivery_fee_kobo + v_service_fee_kobo;

  -- payment_method stays null: with Monnify's hosted checkout, the channel
  -- (card/bank_transfer/ussd) is chosen on Monnify's own page, not ours —
  -- capture_payment() fills it in from the verified transaction.
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

  insert into order_items (order_id, menu_item_id, name_snapshot, unit_price_kobo, qty, options_snapshot, line_total_kobo)
  select
    v_order.id,
    ci.menu_item_id,
    mi.name,
    mi.price_kobo + coalesce((
      select sum(o.price_delta_kobo)
      from jsonb_array_elements(ci.options_snapshot) elem
      join options o on o.id = (elem ->> 'optionId')::uuid
    ), 0),
    ci.qty,
    ci.options_snapshot,
    (mi.price_kobo + coalesce((
      select sum(o.price_delta_kobo)
      from jsonb_array_elements(ci.options_snapshot) elem
      join options o on o.id = (elem ->> 'optionId')::uuid
    ), 0)) * ci.qty
  from cart_items ci
  join menu_items mi on mi.id = ci.menu_item_id
  where ci.cart_id = p_cart_id;

  update carts set status = 'converted' where id = p_cart_id;

  return v_order;
end;
$$;

comment on function place_order(uuid, jsonb, geography, text) is
  'The only writer of the orders/order_items INSERT path. Mirrors packages/domain/src/delivery.ts — keep both in sync.';

revoke execute on function place_order(uuid, jsonb, geography, text) from public;
grant execute on function place_order(uuid, jsonb, geography, text) to authenticated;
