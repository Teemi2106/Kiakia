-- KiaKia — fix: place_order() (last redefined in 0011_delivery_code.sql)
-- derived line-item prices from two unscoped joins:
--
--   join menu_items mi on mi.id = ci.menu_item_id
--   join options o on o.id = (elem->>'optionId')::uuid
--
-- Neither confirmed mi.vendor_id matches the cart's own vendor, nor that
-- the option resolved through an option_group belonging to that specific
-- menu_item. Combined with options.price_delta_kobo having no >= 0
-- constraint, an attacker could register their own vendor, create a menu
-- item with an option whose price_delta_kobo is a large negative number,
-- then put a *different* (victim) vendor's real item in their cart
-- referencing that option's id in options_snapshot — place_order would
-- subtract the negative delta from the victim item's real price, hugely
-- discounting or zeroing the order while the victim vendor still ships the
-- real product.
--
-- Fix, three parts:
--   1. options.price_delta_kobo gets a >= 0 check constraint — a discount
--      option was never a legitimate concept in this schema (menu_items
--      already has one absolute price_kobo; there is no "menu item on
--      sale" feature this delta was ever meant to express negatively).
--   2. Both joins are scoped: menu_items to the cart's own vendor_id (and
--      is_available), options through option_groups scoped to the exact
--      menu_item_id being priced (and is_available). A cart item or option
--      that fails to resolve under that scope now raises rather than being
--      silently dropped from the sum (which would have UNDER-priced the
--      order, not zeroed it, since the inner join just excludes the row).
--   3. vendors.min_order_kobo (shown client-side only until now) is
--      enforced server-side against the re-derived subtotal.
--
-- While rewriting this function's body anyway, also folds in the fix for
-- the non-cryptographic delivery_code generator (0011_delivery_code.sql):
-- lpad(floor(random() * 10000)::text, ...) uses Postgres's regular PRNG,
-- predictable/seedable and not suitable for a code that gates rider
-- handover (§6.8) — switched to pgcrypto's gen_random_bytes (already
-- enabled, 0001_extensions.sql).

-- Guard against a bad constraint if any row happens to violate it — fail
-- loudly rather than silently leaving negative deltas in place. This repo
-- has no live/seeded data with a negative price_delta_kobo as of this
-- migration (supabase/seed.sql defines none), but this statement will
-- itself refuse to apply (and the migration will fail) if that's ever not
-- true, rather than silently succeeding partway.
alter table options
  add constraint options_price_delta_kobo_check check (price_delta_kobo >= 0);

create or replace function place_order(
  p_cart_id           uuid,
  p_delivery_address  jsonb,
  p_delivery_location geography(point, 4326),
  p_delivery_note     text default null
)
returns orders
language plpgsql
security definer
-- B3 (independent security review): this function calls pgcrypto's
-- gen_random_bytes() below (the fix for the predictable delivery_code
-- generator, see header). On Supabase, pgcrypto is installed into the
-- `extensions` schema, not `public` (0001_extensions.sql's
-- `create extension "pgcrypto"` has no explicit SCHEMA clause, so it lands
-- wherever the platform's convention puts it — confirmed by
-- supabase/config.toml's `extra_search_path = ["public", "extensions"]`,
-- which exists specifically because PostgREST/Studio need `extensions` on
-- their search path to resolve functions like this one). A SECURITY DEFINER
-- function's `set search_path` REPLACES the session's search_path entirely
-- rather than extending it, so `set search_path = public` alone would raise
-- `function gen_random_bytes(integer) does not exist` on every single
-- place_order() call — this was never executed against a real Postgres
-- instance before this fix (no Docker/Supabase CLI in this dev environment).
-- `extensions` is added to the safe superset alongside `public`. Deliberately
-- NOT listing `pg_catalog` explicitly: naming it demotes core catalog
-- functions/operators/types below `public`/`extensions` in resolution order
-- (Postgres only implicitly searches pg_catalog *first* when it is left
-- unnamed) — a needless footgun here, since `authenticated` has no CREATE
-- privilege on either schema to shadow anything in practice, but there's no
-- reason to take the risk. No other function touched in 0015-0017 calls a
-- pgcrypto function under a narrow search_path (checked — transition_order
-- and capture_payment call no crypto functions), so this is the only one
-- that needs the extra schema.
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

  -- Every cart item must resolve to a menu item that (a) actually belongs
  -- to this cart's own vendor and (b) is currently available, and every
  -- option referenced in its options_snapshot must resolve to an option
  -- (b) available, (c) reached through an option_group belonging to THAT
  -- SAME menu item — not merely to any menu item, which is what let a
  -- cross-vendor option id be used to forge a price before this fix.
  -- Raising here rather than letting the pricing joins below silently drop
  -- an unresolved row is deliberate: a dropped row would UNDER-price the
  -- order (excluded from the sum entirely), not just mis-price it.
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

  -- Re-derive the subtotal from live menu_items/options prices — every
  -- join below is scoped by the checks above, so an unscoped cross-vendor
  -- option id can no longer contribute to this sum.
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

  -- Enforce the vendor's minimum order value server-side (previously
  -- shown in the UI only, never enforced — an attacker could bypass the
  -- client entirely and place a below-minimum order).
  if v_subtotal_kobo < v_vendor.min_order_kobo then
    raise exception 'place_order: subtotal % kobo is below vendor %''s minimum order of % kobo',
      v_subtotal_kobo, v_vendor.id, v_vendor.min_order_kobo
      using errcode = 'check_violation';
  end if;

  -- Fees — mirrors packages/domain/src/delivery.ts's computeDeliveryFee/computeServiceFee.
  v_distance_m := st_distance(v_vendor.location, p_delivery_location);

  if v_area.free_above_kobo is not null and v_subtotal_kobo >= v_area.free_above_kobo then
    v_delivery_fee_kobo := 0;
  else
    v_delivery_fee_kobo := v_area.base_delivery_fee_kobo + v_area.per_km_fee_kobo * ceil(v_distance_m / 1000.0)::bigint;
  end if;

  v_service_fee_kobo := round(v_subtotal_kobo * 200 / 10000.0); -- SERVICE_FEE_BPS = 200
  v_total_kobo := v_subtotal_kobo + v_delivery_fee_kobo + v_service_fee_kobo;

  insert into orders (
    customer_id, vendor_id, service_area_id, subtotal_kobo, delivery_fee_kobo,
    service_fee_kobo, discount_kobo, total_kobo, delivery_address,
    delivery_location, delivery_note, distance_m, delivery_code
  ) values (
    auth.uid(), v_cart.vendor_id, v_area.id, v_subtotal_kobo, v_delivery_fee_kobo,
    v_service_fee_kobo, 0, v_total_kobo, p_delivery_address,
    p_delivery_location, p_delivery_note, round(v_distance_m),
    -- Cryptographically-random 4-digit code (pgcrypto's gen_random_bytes),
    -- not the regular (predictable, seedable) random() PRNG — see this
    -- migration's header. encode(...)::bit(32)::bigint reads the 4 random
    -- bytes as an unsigned 32-bit integer; % 10000 keeps it 4 digits.
    lpad((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 10000)::text, 4, '0')
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
  'The only writer of the orders/order_items INSERT path. Mirrors packages/domain/src/delivery.ts — keep both in sync. Pricing joins are vendor/menu-item-scoped and min_order_kobo is enforced server-side — see 0016_fix_place_order_pricing_scope.sql.';

revoke execute on function place_order(uuid, jsonb, geography, text) from public;
grant execute on function place_order(uuid, jsonb, geography, text) to authenticated;
