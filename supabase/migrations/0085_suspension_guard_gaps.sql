-- KiaKia - close the suspension gaps 0082 left on end-user RPCs, and drop
-- table privileges no client should hold.
--
-- 1. _assert_active_caller() (0082) on the remaining writes a suspended
--    account should not be able to make with a token that is still valid:
--
--      place_order                 new orders (the webhook would then capture them)
--      submit_order_rating         public, vendor- and rider-facing content
--      register_rider              creates or rewrites a rider profile
--      update_rider_bank_details   the payout destination - exactly what a
--                                  suspension of a possibly compromised account
--                                  must freeze
--      register_rider_push_token   guarded with the finishing allowance, so a
--                                  suspended rider completing a picked-up
--                                  delivery keeps receiving its notifications
--
--    Deliberately left open: the unregister_* functions (giving up a channel is
--    always fine), register_web_push_subscription (a device subscription grants
--    no capability, and a suspended customer may still be owed refund and
--    cancellation notices), and the own-data reads (get_order_tracking,
--    get_rider_offer_details, get_rider_earnings*, get_wallet_*) - a rider
--    finishing a delivery needs get_rider_offer_details, and reading one's own
--    data changes nothing.
--
--    Each function is its live definition with only the guard line added.
--    Grants are kept by CREATE OR REPLACE.
--
-- 2. Supabase's default privileges grant every table in public to anon and
--    authenticated, and the RLS migrations only ever revoked insert/update/
--    delete. TRUNCATE, TRIGGER and REFERENCES were left behind on most tables.
--    PostgREST cannot issue TRUNCATE, so this was not reachable through the API,
--    but TRUNCATE bypasses RLS entirely and no client role has any use for any
--    of the three. Revoked on every table this role owns and for future ones.


-- place_order(): live definition, guard added.
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
$function$;

-- submit_order_rating(): live definition, guard added.
CREATE OR REPLACE FUNCTION public.submit_order_rating(p_order_id uuid, p_vendor_rating smallint, p_vendor_comment text DEFAULT NULL::text, p_rider_rating smallint DEFAULT NULL::smallint, p_rider_comment text DEFAULT NULL::text)
 RETURNS order_ratings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order  orders;
  v_rating order_ratings;
begin
  if auth.uid() is null then
    raise exception 'submit_order_rating: no authenticated caller';
  end if;

  perform _assert_active_caller();

  if p_vendor_rating is null or p_vendor_rating not between 1 and 5 then
    raise exception 'submit_order_rating: vendor_rating must be between 1 and 5';
  end if;

  if p_rider_rating is not null and p_rider_rating not between 1 and 5 then
    raise exception 'submit_order_rating: rider_rating must be between 1 and 5';
  end if;

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'submit_order_rating: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if auth.uid() is distinct from v_order.customer_id then
    raise exception 'submit_order_rating: actor % is not the customer on order %', auth.uid(), p_order_id;
  end if;

  -- Rating a delivery that never happened doesn't mean anything - same
  -- reasoning transition_order() enforces for the escrow-release guard on
  -- `delivered` itself (0030).
  if v_order.status <> 'delivered' then
    raise exception 'submit_order_rating: order % has not been delivered', p_order_id
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from order_ratings where order_id = p_order_id) then
    raise exception 'submit_order_rating: order % has already been rated', p_order_id
      using errcode = 'unique_violation';
  end if;

  -- rider_id/rider_rating/rider_comment only make sense together - a
  -- rating with no rider to attach it to is just noise on the rider side.
  insert into order_ratings (
    order_id, customer_id, vendor_id, rider_id,
    vendor_rating, vendor_comment, rider_rating, rider_comment
  )
  values (
    p_order_id, auth.uid(), v_order.vendor_id,
    case when v_order.rider_id is not null and p_rider_rating is not null then v_order.rider_id end,
    p_vendor_rating, p_vendor_comment,
    case when v_order.rider_id is not null then p_rider_rating end,
    case when v_order.rider_id is not null then p_rider_comment end
  )
  returning * into v_rating;

  -- Incremental average - exact for this purpose (not a running sum divided
  -- by a separately-tracked count that could drift), and never requires
  -- scanning every prior rating to update one row.
  update vendors
  set rating_avg = (rating_avg * rating_count + p_vendor_rating) / (rating_count + 1),
      rating_count = rating_count + 1
  where id = v_order.vendor_id;

  if v_rating.rider_id is not null then
    update riders
    set rating_avg = (rating_avg * rating_count + p_rider_rating) / (rating_count + 1),
        rating_count = rating_count + 1
    where user_id = v_rating.rider_id;
  end if;

  return v_rating;
end;
$function$;

-- register_rider(): live definition, guard added.
CREATE OR REPLACE FUNCTION public.register_rider(p_vehicle_type text, p_plate_number text)
 RETURNS riders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rider riders;
begin
  perform _assert_active_caller();

  -- Upsert on the caller's own row (user_id = auth.uid(), the table's
  -- primary key — see 0002_identity.sql). kyc_status and is_online are
  -- OMITTED from both the insert column list's overridable values and the
  -- ON CONFLICT DO UPDATE SET clause: on first insert they take their
  -- column defaults ('pending' / false — 0002_identity.sql), and on a
  -- repeat call (safe to call twice, e.g. the rider app re-submitting
  -- vehicle details) they are left completely untouched at whatever an
  -- admin RPC (approve_rider/reject_rider, 0028) or set_rider_online (below)
  -- last set them to.
  insert into riders (user_id, vehicle_type, plate_number)
  values (auth.uid(), p_vehicle_type, p_plate_number)
  on conflict (user_id) do update set
    vehicle_type = excluded.vehicle_type,
    plate_number = excluded.plate_number
  returning * into v_rider;

  -- Mirrors register_vendor()'s own elevation step (0009_register_vendor.sql):
  -- holding the 'rider' role is what the permission model (§13) expects to
  -- exist alongside a riders row, even though nothing in this repo currently
  -- checks user_roles for rider-ness (authorization here is entirely via the
  -- riders table itself). on conflict do nothing makes this safe to call
  -- every time register_rider() is, not just the first.
  insert into user_roles (user_id, role)
  values (auth.uid(), 'rider')
  on conflict do nothing;

  return v_rider;
end;
$function$;

-- update_rider_bank_details(): live definition, guard added.
CREATE OR REPLACE FUNCTION public.update_rider_bank_details(p_bank_name text, p_account_name text, p_account_number text)
 RETURNS riders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rider riders;
  v_bank_name text := btrim(p_bank_name);
  v_account_name text := btrim(p_account_name);
  v_account_number text := btrim(p_account_number);
begin
  if auth.uid() is null then
    raise exception 'update_rider_bank_details: no authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  perform _assert_active_caller();

  if v_bank_name is null or char_length(v_bank_name) not between 2 and 100 then
    raise exception 'update_rider_bank_details: bank name must be between 2 and 100 characters'
      using errcode = 'check_violation';
  end if;
  if v_account_name is null or char_length(v_account_name) not between 2 and 150 then
    raise exception 'update_rider_bank_details: account name must be between 2 and 150 characters'
      using errcode = 'check_violation';
  end if;
  if v_account_number is null or v_account_number !~ '^[0-9]{10}$' then
    raise exception 'update_rider_bank_details: account number must contain exactly 10 digits'
      using errcode = 'check_violation';
  end if;

  update riders
  set bank_name = v_bank_name,
      bank_account_name = v_account_name,
      bank_account_number = v_account_number
  where user_id = auth.uid()
  returning * into v_rider;

  if not found then
    raise exception 'update_rider_bank_details: no rider row for the caller -- call register_rider() first'
      using errcode = 'no_data_found';
  end if;

  return v_rider;
end;
$function$;

-- register_rider_push_token(): live definition, guard added.
CREATE OR REPLACE FUNCTION public.register_rider_push_token(p_token text, p_platform text, p_device_id text DEFAULT NULL::text)
 RETURNS rider_push_tokens
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_token             rider_push_tokens;
  v_reassigned_riders  uuid[];
begin
  if auth.uid() is null then
    raise exception 'register_rider_push_token: no authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- A suspended rider finishing a picked-up delivery keeps notifications (0082).
  perform _assert_active_caller(true);

  if not exists (select 1 from riders where user_id = auth.uid()) then
    raise exception 'register_rider_push_token: no rider row for the caller - call register_rider() first'
      using errcode = 'no_data_found';
  end if;

  if p_platform not in ('ios', 'android') then
    raise exception 'register_rider_push_token: unknown platform %', p_platform
      using errcode = 'check_violation';
  end if;

  if p_token is null or length(p_token) = 0 then
    raise exception 'register_rider_push_token: p_token must not be empty'
      using errcode = 'check_violation';
  end if;

  -- 0056 fix, unchanged shape: an Expo push token identifies a DEVICE, and
  -- a device has exactly one signed-in rider at a time. Remove any row a
  -- DIFFERENT rider holds for this exact token before upserting the
  -- caller's own, so a sign-out/sign-in handoff on the same phone
  -- transfers ownership instead of leaving the token registered under
  -- both riders.
  --
  -- 0057 TASK 6 fix: capture which rider(s) actually lost a row here, so
  -- an audit notification can be written for each one below - see this
  -- migration's header for why an audit trail was chosen over scoping the
  -- delete to a device_id match.
  with reassigned as (
    delete from rider_push_tokens
    where token = p_token
      and rider_id is distinct from auth.uid()
    returning rider_id
  )
  select coalesce(array_agg(distinct rider_id), array[]::uuid[])
  into v_reassigned_riders
  from reassigned;

  if array_length(v_reassigned_riders, 1) > 0 then
    insert into rider_notifications (rider_id, title, body)
    select
      lost_rider_id,
      'Push notifications moved to another sign-in',
      'This device signed in with a different rider account, so push notifications for it now go to that account instead. If this was not you, contact support.'
    from unnest(v_reassigned_riders) as lost_rider_id;
  end if;

  insert into rider_push_tokens (rider_id, token, platform, device_id)
  values (auth.uid(), p_token, p_platform, p_device_id)
  on conflict (rider_id, token) do update set
    platform   = excluded.platform,
    device_id  = excluded.device_id
  returning * into v_token;

  return v_token;
end;
$function$;

-- Client roles never need these, and TRUNCATE ignores RLS. Only tables this
-- role owns: PostGIS's own (spatial_ref_sys and its views) are not ours to change.
do $do$
declare
  v_table text;
begin
  for v_table in select tablename from pg_tables where schemaname = 'public' and tableowner = current_user loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', v_table);
  end loop;
end
$do$;

alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;
