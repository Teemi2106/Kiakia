-- KiaKia - admin-configurable platform fees.
--
-- AUDIT (what was hard-coded before this migration):
--   customer service fee    2% of subtotal, literal `200` inside place_order()
--                           (mirrored by SERVICE_FEE_BPS in packages/domain).
--                           NOW: platform_settings 'service_fee_bps'.
--   default vendor commission  vendors.commission_bps column DEFAULT 1500.
--                           NOW: platform_settings 'default_vendor_commission_bps',
--                           applied to vendors created from now on only.
--   already editable, unchanged here: per-vendor commission
--     (admin_set_vendor_commission), customer delivery fee and rider pay
--     rates per service area (admin_update_service_area, 0081).
--   no such fee exists: VAT/tax, small-order fee, payment-gateway fee (the
--     platform absorbs the gateway cost; vendors.min_order_kobo is a
--     per-vendor rule, not a platform fee).
--
-- STORAGE. platform_settings: one row per key, typed (integer value + unit),
-- a CHECK that whitelists the key and bounds its value, updated_at/by.
-- RLS enabled with no policies; every client role is revoked; service_role
-- may SELECT only. The single writer is admin_set_platform_fee(), SECURITY
-- DEFINER, service_role only, finance tier, audited with before/after.
-- Adding a new fee later = one row + one extra branch in the CHECK.
--
-- SNAPSHOT SEMANTICS. place_order() reads the rate with a plain select in the
-- same transaction that inserts the order: it prices with one committed value
-- (READ COMMITTED, no caching anywhere) and orders.service_fee_kobo stores the
-- resulting amount, so a later change never touches an existing order. The
-- release function pays out from the order's own stored columns
-- (total_kobo, rider_fee_kobo) so it is unaffected. Vendor COMMISSION is the
-- exception and stays as 0057/0081 documented: read at release time from
-- vendors.commission_bps. The default-commission setting therefore only
-- decides the starting value of a new vendor row; it never changes anyone
-- already on the platform.
--
-- Bounds: service fee 0-2000 bps (0-20%), default commission 0-5000 bps
-- (0-50%; admin_set_vendor_commission itself still allows up to 10000).

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table platform_settings (
  key         text primary key,
  id          uuid not null unique default uuid_generate_v7(),
  value_int   bigint not null,
  unit        text not null check (unit in ('bps', 'kobo')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id),
  constraint platform_settings_known_key_and_bounds check (
    (key = 'service_fee_bps' and unit = 'bps' and value_int between 0 and 2000)
    or (key = 'default_vendor_commission_bps' and unit = 'bps' and value_int between 0 and 5000)
  )
);

comment on table platform_settings is
  'Admin-configurable platform-level fees, one row per key. Written only by admin_set_platform_fee() (audited). Read by place_order() and the vendors.commission_bps column default via _platform_setting_int(). service_role may select; no client role has any access.';

alter table platform_settings enable row level security;
revoke all on platform_settings from public, anon, authenticated, service_role;
grant select on platform_settings to service_role;

insert into platform_settings (key, value_int, unit) values
  ('service_fee_bps', 200, 'bps'),
  ('default_vendor_commission_bps', 1500, 'bps');

-- audit log: allow the new target type.
alter table admin_audit_log drop constraint admin_audit_log_target_type_check;
alter table admin_audit_log add constraint admin_audit_log_target_type_check
  check (target_type in ('user', 'vendor', 'rider', 'rider_document', 'order', 'service_area', 'export', 'platform_setting')) not valid;
alter table admin_audit_log validate constraint admin_audit_log_target_type_check;

-- ---------------------------------------------------------------------------
-- Readers
-- ---------------------------------------------------------------------------

-- Internal reader. Raises rather than defaulting: a missing fee row must stop
-- an order, never silently price it at zero.
create function _platform_setting_int(p_key text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_value bigint;
begin
  select value_int into v_value from platform_settings where key = p_key;
  if v_value is null then
    raise exception '_platform_setting_int: platform setting % is not configured', p_key;
  end if;
  return v_value;
end;
$$;

comment on function _platform_setting_int(text) is
  'Internal: current value of a platform_settings key, or raises. Used by place_order() and the vendors.commission_bps default. Not callable by client roles.';

revoke all on function _platform_setting_int(text) from public, anon, authenticated;
grant execute on function _platform_setting_int(text) to service_role;

-- Customer-visible: the live service fee rate, so checkout can show what
-- place_order() will charge. Reveals only a price the customer pays anyway.
create function get_service_fee_bps()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select _platform_setting_int('service_fee_bps')::integer;
$$;

comment on function get_service_fee_bps() is
  'The current customer service fee in basis points (the same value place_order() applies). For the checkout estimate; never authoritative.';

revoke execute on function get_service_fee_bps() from public, anon;
grant execute on function get_service_fee_bps() to authenticated, service_role;

-- New vendors start at the admin-set default. Existing vendors are untouched
-- (a column default only applies to rows inserted after it is set).
alter table vendors alter column commission_bps
  set default (_platform_setting_int('default_vendor_commission_bps')::integer);

-- ---------------------------------------------------------------------------
-- admin_set_platform_fee
-- ---------------------------------------------------------------------------

create function admin_set_platform_fee(
  p_key        text,
  p_value      bigint,
  p_reason     text,
  p_actor_id   uuid
)
returns platform_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     platform_settings;
  v_before  bigint;
  v_reason  text;
begin
  perform _assert_admin_actor('admin_set_platform_fee', p_actor_id, 'finance');
  v_reason := _admin_reason('admin_set_platform_fee', p_reason, true);

  if p_key is null or p_value is null then
    raise exception 'admin_set_platform_fee: a fee and a value are required'
      using errcode = 'check_violation';
  end if;

  if p_key = 'service_fee_bps' then
    if p_value not between 0 and 2000 then
      raise exception 'admin_set_platform_fee: the service fee must be between 0%% and 20%% (0-2000 basis points), got % basis points', p_value
        using errcode = 'check_violation';
    end if;
  elsif p_key = 'default_vendor_commission_bps' then
    if p_value not between 0 and 5000 then
      raise exception 'admin_set_platform_fee: the default commission must be between 0%% and 50%% (0-5000 basis points), got % basis points', p_value
        using errcode = 'check_violation';
    end if;
  else
    raise exception 'admin_set_platform_fee: unknown fee %', p_key
      using errcode = 'check_violation';
  end if;

  select * into v_row from platform_settings where key = p_key for update;
  if not found then
    raise exception 'admin_set_platform_fee: fee % is not configured', p_key
      using errcode = 'no_data_found';
  end if;

  v_before := v_row.value_int;
  if v_before = p_value then
    return v_row;
  end if;

  update platform_settings
  set value_int = p_value, updated_at = now(), updated_by = p_actor_id
  where key = p_key
  returning * into v_row;

  perform _write_admin_audit(p_actor_id, 'platform_fee.set', 'platform_setting', v_row.id, v_reason,
    jsonb_build_object('key', p_key, 'unit', v_row.unit, 'from', v_before, 'to', p_value));

  return v_row;
end;
$$;

comment on function admin_set_platform_fee(text, bigint, text, uuid) is
  'Sets a platform_settings fee (service_fee_bps 0-2000, default_vendor_commission_bps 0-5000), row-locked, audited with before/after. Applies to orders placed (service fee) or vendors created (default commission) AFTER the change; existing orders and vendors are untouched. Unchanged value is a no-op with no audit row. service_role only; actor must be a superadmin or hold the finance role.';

revoke execute on function admin_set_platform_fee(text, bigint, text, uuid) from public, anon, authenticated;
grant execute on function admin_set_platform_fee(text, bigint, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- place_order(): 0085's definition verbatim except the service-fee line.
-- CREATE OR REPLACE keeps the existing grants (authenticated only).
-- ---------------------------------------------------------------------------

-- (place_order body follows)
CREATE OR REPLACE FUNCTION public.place_order(p_cart_id uuid, p_delivery_address jsonb, p_delivery_location geography, p_delivery_note text DEFAULT NULL::text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  perform _assert_active_caller();

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

  -- 0077: the vendor's own delivery radius (Settings > Delivery zone) was
  -- collected and shown to the vendor as "customers outside this radius won't
  -- see your store" but never enforced; a 100 m radius still took an order
  -- 2.8 km away.
  if v_distance_m > v_vendor.delivery_radius_m then
    raise exception 'place_order: delivery address is outside this vendor''s delivery radius'
      using errcode = 'check_violation';
  end if;

  -- Always charged. No free-delivery waiver any more - see this
  -- migration's header for why.
  v_delivery_fee_kobo := v_area.base_delivery_fee_kobo + v_area.per_km_fee_kobo * ceil(v_distance_m / 1000.0)::bigint;

  -- 0092: the rate is the admin-set platform_settings row, read inside the
  -- same transaction that inserts the order; orders.service_fee_kobo
  -- snapshots the result. Seeded at 200 bps (the old hard-coded value).
  v_service_fee_kobo := round(v_subtotal_kobo * _platform_setting_int('service_fee_bps') / 10000.0);
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
$function$;
