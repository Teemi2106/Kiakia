-- KiaKia - input and exposure hardening found by end-to-end QA.
--
--   1. cart_items.qty had no upper bound: 2147483647 produced a draft order
--      totalling ~5.5e14 kobo. Capped at 99 per line.
--   2. menu_items.price_kobo allowed 0 and had no ceiling; options had no
--      ceiling either. Price must now be 1 kobo to 100,000,000 kobo (NGN 1M).
--   3. place_order() ignored vendors.delivery_radius_m. Now enforced.
--   4. register_web_push_subscription() accepted any endpoint URL, so a user
--      could make the web-push Edge Function issue requests to an internal or
--      metadata address (SSRF). Endpoints must be https on a known push service
--      host, key sizes are bounded, and a user keeps at most 10 subscriptions.
--   5. Vendor staff saw customer names and phones on the orders list only in
--      theory: profiles is own-row-only under RLS, so the direct read returned
--      nothing. get_vendor_order_customers() is the scoped read: only staff of
--      the order's vendor, only while the order is still in flight.
--   6. profiles.phone accepted any string when written directly. Now E.164 or
--      NULL, and the signup trigger stores NULL rather than failing signup when
--      the supplied number does not fit.
--   7. Logged-out (anon) clients could read vendors.commission_bps and
--      kyc_status. Nothing anonymous reads vendors, so anon now gets an explicit
--      column list without them. NOTE: a column added to vendors later is NOT
--      visible to anon until granted here; that is the safe default.
--
-- place_order() and handle_new_auth_user() are reproduced from their LIVE
-- definitions with only the changes described above.


-- 1 + 2 --------------------------------------------------------------------

alter table cart_items add constraint cart_items_qty_max check (qty <= 99);

alter table menu_items drop constraint menu_items_price_kobo_check;
alter table menu_items add constraint menu_items_price_kobo_range check (price_kobo between 1 and 100000000);

alter table options add constraint options_price_delta_kobo_max check (price_delta_kobo <= 100000000);

-- 3 ------------------------------------------------------------------------

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
$function$
;

-- 4 ------------------------------------------------------------------------

create or replace function register_web_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'register_web_push_subscription: no authenticated user';
  end if;

  -- Only the real push services. A subscription endpoint is a URL this
  -- project's Edge Function will POST to, so anything else is a way to aim
  -- server-side requests at an address of the caller's choosing. The slash
  -- straight after the host rules out userinfo tricks (https://host@evil/).
  if p_endpoint is null
     or length(p_endpoint) > 2048
     or p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|web\.push\.apple\.com)/' then
    raise exception 'register_web_push_subscription: endpoint is not a recognised push service'
      using errcode = 'check_violation';
  end if;

  if p_p256dh is null or length(p_p256dh) not between 20 and 200
     or p_auth is null or length(p_auth) not between 8 and 100 then
    raise exception 'register_web_push_subscription: invalid subscription keys'
      using errcode = 'check_violation';
  end if;

  insert into web_push_subscriptions (user_id, endpoint, p256dh, auth_key)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (user_id, endpoint) do update
    set p256dh = excluded.p256dh,
        auth_key = excluded.auth_key,
        updated_at = now();

  -- Bounded per user: a browser only ever has one live subscription per
  -- origin, so ten is generous (phone, laptop, a few browsers) and stops the
  -- table being used as free storage.
  delete from web_push_subscriptions
  where user_id = auth.uid()
    and endpoint in (
      select endpoint from web_push_subscriptions
      where user_id = auth.uid()
      order by updated_at desc
      offset 10
    );
end;
$function$;

-- 5 ------------------------------------------------------------------------

create function get_vendor_order_customers(p_order_ids uuid[])
returns table (
  order_id       uuid,
  customer_name  text,
  customer_phone text
)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'get_vendor_order_customers: no authenticated caller';
  end if;

  if cardinality(p_order_ids) > 200 then
    raise exception 'get_vendor_order_customers: at most 200 orders per call'
      using errcode = 'check_violation';
  end if;

  -- Staff of the order's own vendor only, and only while the order is still
  -- in flight: a customer's number is for fulfilling this order, not a
  -- permanent record vendor staff keep access to.
  return query
  select o.id, p.full_name, p.phone
  from orders o
  join profiles p on p.id = o.customer_id
  where o.id = any (p_order_ids)
    and o.status in ('placed', 'accepted', 'preparing', 'ready_for_pickup', 'rider_assigned', 'picked_up', 'in_transit', 'arrived')
    and exists (
      select 1 from vendor_staff vs
      where vs.vendor_id = o.vendor_id and vs.user_id = auth.uid()
    );
end;
$function$;

comment on function get_vendor_order_customers(uuid[]) is
  'Customer name and phone for the caller''s own vendor''s in-flight orders. SECURITY DEFINER because profiles is own-row-only under RLS, so vendor staff cannot read a customer''s profile directly. Returns nothing for orders of other vendors or already-finished orders. At most 200 order ids per call.';

revoke execute on function get_vendor_order_customers(uuid[]) from public, anon;
grant execute on function get_vendor_order_customers(uuid[]) to authenticated;

-- 6 ------------------------------------------------------------------------

alter table profiles add constraint profiles_phone_e164 check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_phone text := coalesce(new.phone, new.raw_user_meta_data ->> 'phone');
begin
  -- auth.users.phone (phone-OTP) is stored without the leading +; metadata
  -- phone from both apps arrives already as +234.... Anything that still is
  -- not E.164 is dropped to NULL instead of failing the whole signup.
  if v_phone ~ '^[1-9][0-9]{7,14}$' then
    v_phone := '+' || v_phone;
  end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    v_phone := null;
  end if;

  insert into public.profiles (id, phone, full_name)
  values (new.id, v_phone, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'customer')
  on conflict (user_id, role) where (scope_type = 'platform') do nothing;

  return new;
end;
$function$;

-- 7 ------------------------------------------------------------------------

do $do$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
  into v_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'vendors'
    and column_name not in ('commission_bps', 'kyc_status');

  revoke select on public.vendors from anon;
  execute format('grant select (%s) on public.vendors to anon', v_cols);
end;
$do$;
