-- Fundable customer wallet and KiaKia Coins rewards.
--
-- Wallet funding enters through Monnify and is recorded as a balanced ledger
-- transaction. A provider redirect or client request is never proof of
-- payment: capture_wallet_topup() is service-role only and is called only
-- after the webhook or a server-side Monnify status check verifies payment.

-- ---------------------------------------------------------------------------
-- 1. Admin-configurable cashback rate (basis points; 50 = 0.5%).
-- ---------------------------------------------------------------------------

alter table platform_settings
  drop constraint if exists platform_settings_known_key_and_bounds;

alter table platform_settings
  add constraint platform_settings_known_key_and_bounds check (
    (key = 'service_fee_bps' and unit = 'bps' and value_int between 0 and 2000)
    or (key = 'default_vendor_commission_bps' and unit = 'bps' and value_int between 0 and 5000)
    or (key = 'dispatch_radius_m' and unit = 'm' and (value_int = 0 or value_int between 1000 and 50000))
    or (key = 'dispatch_max_riders' and unit = 'count' and value_int between 1 and 50)
    or (key = 'dispatch_widen_after_seconds' and unit = 'seconds' and value_int between 0 and 1800)
    or (key = 'dispatch_location_max_age_seconds' and unit = 'seconds' and value_int between 60 and 300)
    or (key = 'dispatch_notify_vendor_after_seconds' and unit = 'seconds' and value_int between 0 and 1800)
    or (key = 'dispatch_offer_timeout_seconds' and unit = 'seconds' and value_int between 15 and 120)
    or (key = 'dispatch_h3_resolution' and unit = 'count' and value_int between 7 and 9)
    or (key = 'dispatch_h3_initial_ring' and unit = 'count' and value_int between 0 and 10)
    or (key = 'dispatch_h3_max_ring' and unit = 'count' and value_int between 1 and 30)
    or (key = 'dispatch_secure_buffer_seconds' and unit = 'seconds' and value_int between 45 and 900)
    or (key = 'dispatch_default_travel_seconds' and unit = 'seconds' and value_int between 60 and 3600)
    or (key = 'dispatch_default_speed_kmh' and unit = 'kmh' and value_int between 5 and 60)
    or (key = 'dispatch_road_factor_pct' and unit = 'pct' and value_int between 100 and 250)
    or (key = 'dispatch_min_history_samples' and unit = 'count' and value_int between 5 and 1000)
    or (key = 'dispatch_vendor_arrival_radius_m' and unit = 'm' and value_int between 30 and 500)
    or (key = 'cashback_bps' and unit = 'bps' and value_int between 0 and 5000)
  );

insert into platform_settings (key, value_int, unit)
values ('cashback_bps', 50, 'bps');

create or replace function admin_set_platform_fee(
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
  elsif p_key = 'cashback_bps' then
    if p_value not between 0 and 5000 then
      raise exception 'admin_set_platform_fee: cashback must be between 0%% and 50%% (0-5000 basis points), got % basis points', p_value
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
  'Sets service_fee_bps (0-2000), default_vendor_commission_bps (0-5000), or cashback_bps (0-5000), row-locked and audited with before/after. Cashback rates are snapshotted on new orders and awarded after delivery. Service fee applies to new orders; default commission applies to new vendors. service_role only; actor must be a superadmin or hold the finance role.';

-- ---------------------------------------------------------------------------
-- 2. Snapshot the earning rate when the order is created.
-- ---------------------------------------------------------------------------

alter table orders
  add column cashback_bps_snapshot integer;

alter table orders
  add constraint orders_cashback_bps_snapshot_check
  check (cashback_bps_snapshot is null or cashback_bps_snapshot between 0 and 5000);

create or replace function snapshot_order_cashback_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cashback_bps_snapshot is null then
    new.cashback_bps_snapshot := _platform_setting_int('cashback_bps')::integer;
  end if;
  return new;
end;
$$;

revoke all on function snapshot_order_cashback_rate() from public, anon, authenticated;

create trigger orders_snapshot_cashback_rate
before insert on orders
for each row execute function snapshot_order_cashback_rate();

comment on column orders.cashback_bps_snapshot is
  'Cashback rate in basis points fixed when this order is created. KiaKia Coins are awarded from eligible food spend only after the order is delivered.';

-- ---------------------------------------------------------------------------
-- 3. KiaKia Coins append-only customer reward ledger.
-- ---------------------------------------------------------------------------

create table customer_coin_entries (
  id           uuid primary key default uuid_generate_v7(),
  customer_id  uuid not null references auth.users (id),
  order_id     uuid not null references orders (id),
  entry_type   text not null check (entry_type = 'cashback'),
  coins        bigint not null check (coins > 0),
  created_at   timestamptz not null default now(),
  unique (order_id, entry_type)
);

comment on table customer_coin_entries is
  'Append-only KiaKia Coins earned by the customer. Ten coins represent one naira. The order_id uniqueness guard makes each delivered order award idempotent; there is no coin spending flow yet.';

create index customer_coin_entries_customer_created_idx
  on customer_coin_entries (customer_id, created_at desc);

alter table customer_coin_entries enable row level security;
revoke all on customer_coin_entries from public, anon, authenticated;
grant select on customer_coin_entries to service_role;

create or replace function award_order_cashback_coins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eligible_kobo bigint;
  v_rate_bps      integer;
  v_coins         bigint;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then
    return new;
  end if;

  v_eligible_kobo := greatest(new.subtotal_kobo - new.discount_kobo, 0);
  v_rate_bps := coalesce(new.cashback_bps_snapshot, _platform_setting_int('cashback_bps')::integer);

  -- 100 kobo = ₦1 and 10 coins = ₦1. Applying basis points therefore
  -- converts eligible kobo to coins with a denominator of 100,000.
  v_coins := floor(v_eligible_kobo::numeric * v_rate_bps / 100000)::bigint;
  if v_coins <= 0 then
    return new;
  end if;

  insert into customer_coin_entries (customer_id, order_id, entry_type, coins)
  values (new.customer_id, new.id, 'cashback', v_coins)
  on conflict (order_id, entry_type) do nothing;

  return new;
end;
$$;

revoke all on function award_order_cashback_coins() from public, anon, authenticated;

create trigger orders_award_cashback_coins
after update of status on orders
for each row
when (new.status = 'delivered' and old.status is distinct from new.status)
execute function award_order_cashback_coins();

create or replace function get_kiakia_coin_balance()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'get_kiakia_coin_balance: authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  return coalesce((
    select sum(coins)::bigint from customer_coin_entries where customer_id = v_caller
  ), 0::bigint);
end;
$$;

comment on function get_kiakia_coin_balance() is
  'The authenticated customer''s KiaKia Coins balance. Ten coins represent one naira. Takes no user id so a caller cannot query another customer.';

comment on function get_wallet_balance() is
  'The calling customer''s own wallet balance in kobo, derived from ledger_entries. Takes no arguments by design; funds can come from a verified top-up or refund. Zero before the first credit.';

create or replace function get_cashback_bps()
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'get_cashback_bps: authentication required'
      using errcode = 'insufficient_privilege';
  end if;
  return _platform_setting_int('cashback_bps')::integer;
end;
$$;

comment on function get_cashback_bps() is
  'The current customer-visible KiaKia Coins cashback rate in basis points. The order trigger snapshots this value when each order is placed.';

revoke execute on function get_cashback_bps() from public, anon;
grant execute on function get_cashback_bps() to authenticated, service_role;

revoke execute on function get_kiakia_coin_balance() from public, anon;
grant execute on function get_kiakia_coin_balance() to authenticated, service_role;

create or replace function get_kiakia_coin_transactions(p_limit integer default 50)
returns table (
  created_at timestamptz,
  coins bigint,
  order_id uuid,
  order_code text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'get_kiakia_coin_transactions: authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select e.created_at, e.coins, e.order_id, o.code
  from customer_coin_entries e
  join orders o on o.id = e.order_id
  where e.customer_id = v_caller
  order by e.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

comment on function get_kiakia_coin_transactions(integer) is
  'The authenticated customer''s KiaKia Coins activity, newest first. User id is derived from auth.uid() and p_limit is clamped.';

revoke execute on function get_kiakia_coin_transactions(integer) from public, anon;
grant execute on function get_kiakia_coin_transactions(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Monnify wallet top-ups.
-- ---------------------------------------------------------------------------

alter table transactions
  drop constraint transactions_kind_check;

alter table transactions
  add constraint transactions_kind_check
  check (kind in ('payment_capture', 'escrow_release', 'payout', 'refund', 'adjustment', 'wallet_topup'));

create table wallet_topups (
  id                    uuid primary key default uuid_generate_v7(),
  reference             text not null unique,
  customer_id           uuid not null references auth.users (id),
  amount_kobo           bigint not null check (amount_kobo > 0),
  captured_amount_kobo  bigint check (captured_amount_kobo > 0),
  provider              text not null default 'monnify' check (provider = 'monnify'),
  provider_ref          text unique,
  status                text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  raw                   jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  paid_at               timestamptz
);

comment on table wallet_topups is
  'A Monnify payment intended to fund a customer wallet. Writes are service-role only. The provider reference is verified against Monnify before the matching amount is posted to the customer wallet ledger.';

create index wallet_topups_customer_created_idx on wallet_topups (customer_id, created_at desc);

alter table wallet_topups enable row level security;
revoke all on wallet_topups from public, anon, authenticated;
grant select, insert, update on wallet_topups to service_role;

create or replace function capture_wallet_topup(
  p_reference     text,
  p_provider_ref  text,
  p_amount_kobo   bigint,
  p_raw           jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topup                wallet_topups;
  v_gateway_account_id   uuid;
  v_wallet_account_id    uuid;
  v_transaction_id       uuid;
begin
  if p_reference is null or p_provider_ref is null or p_amount_kobo is null or p_amount_kobo <= 0 then
    raise exception 'capture_wallet_topup: reference, provider reference and positive amount are required'
      using errcode = 'check_violation';
  end if;

  select * into v_topup
  from wallet_topups
  where reference = p_reference
  for update;

  if not found then
    raise exception 'capture_wallet_topup: top-up % does not exist', p_reference
      using errcode = 'no_data_found';
  end if;

  if v_topup.status = 'success' then
    if v_topup.provider_ref is distinct from p_provider_ref then
      raise warning 'capture_wallet_topup: duplicate payment reference % used by provider transaction % after % was already captured',
        p_reference, p_provider_ref, v_topup.provider_ref;
    end if;
    return 'already_captured';
  end if;

  if v_topup.status <> 'pending' then
    raise exception 'capture_wallet_topup: top-up % is not pending', p_reference
      using errcode = 'check_violation';
  end if;

  if v_topup.provider_ref is distinct from p_provider_ref then
    raise exception 'capture_wallet_topup: provider reference does not match the pending top-up'
      using errcode = 'check_violation';
  end if;

  select id into v_gateway_account_id
  from accounts
  where owner_type = 'platform' and owner_id is null and kind = 'gateway';

  if v_gateway_account_id is null then
    raise exception 'capture_wallet_topup: platform gateway account is not seeded';
  end if;

  v_wallet_account_id := _customer_wallet_account_id(v_topup.customer_id);
  if v_wallet_account_id is null then
    raise exception 'capture_wallet_topup: customer wallet could not be created';
  end if;

  insert into transactions (kind, reference, order_id, description)
  values ('wallet_topup', 'wallet-topup:' || p_reference, null, 'Wallet funded through Monnify')
  returning id into v_transaction_id;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values
    (v_transaction_id, v_gateway_account_id, 'debit', p_amount_kobo, 'wallet_topup', null),
    (v_transaction_id, v_wallet_account_id, 'credit', p_amount_kobo, 'wallet_topup', null);

  update wallet_topups
  set status = 'success',
      captured_amount_kobo = p_amount_kobo,
      raw = coalesce(p_raw, '{}'::jsonb),
      paid_at = now()
  where id = v_topup.id;

  return 'captured';
end;
$$;

comment on function capture_wallet_topup(text, text, bigint, jsonb) is
  'Service-role only. Credits the exact amount verified with Monnify to the referenced customer wallet and debits platform:gateway in the same balanced ledger transaction. Row locking and unique transaction references make webhook/redirect capture idempotent.';

revoke execute on function capture_wallet_topup(text, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function capture_wallet_topup(text, text, bigint, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Recipient contact is stored separately so it is not exposed to every
-- rider who receives a delivery offer through orders.delivery_address.
-- ---------------------------------------------------------------------------

create table order_recipient_details (
  order_id       uuid primary key references orders (id) on delete cascade,
  customer_id    uuid not null references auth.users (id),
  recipient_name text not null check (char_length(btrim(recipient_name)) between 2 and 100),
  recipient_phone text not null check (recipient_phone ~ '^\+[1-9][0-9]{7,14}$'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table order_recipient_details is
  'Optional recipient contact for orders placed for someone else. No client role can query this table directly. The customer setter verifies order ownership and draft state; the rider offer RPC reveals contact only to the rider assigned to the order.';

alter table order_recipient_details enable row level security;
revoke all on order_recipient_details from public, anon, authenticated;
grant select on order_recipient_details to service_role;

create or replace function set_order_recipient_details(
  p_order_id       uuid,
  p_recipient_name text,
  p_recipient_phone text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
  v_name text := btrim(coalesce(p_recipient_name, ''));
begin
  if auth.uid() is null then
    raise exception 'set_order_recipient_details: authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  if char_length(v_name) not between 2 and 100
    or p_recipient_phone is null
    or p_recipient_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'set_order_recipient_details: recipient name or phone is invalid'
      using errcode = 'check_violation';
  end if;

  select * into v_order
  from orders
  where id = p_order_id and customer_id = auth.uid()
  for update;

  if not found then
    raise exception 'set_order_recipient_details: order not found'
      using errcode = 'no_data_found';
  end if;

  if v_order.status <> 'draft' or v_order.payment_status <> 'pending' then
    raise exception 'set_order_recipient_details: recipient can only be set before payment'
      using errcode = 'check_violation';
  end if;

  insert into order_recipient_details (order_id, customer_id, recipient_name, recipient_phone)
  values (p_order_id, auth.uid(), v_name, p_recipient_phone)
  on conflict (order_id) do update
  set recipient_name = excluded.recipient_name,
      recipient_phone = excluded.recipient_phone,
      updated_at = now()
  where order_recipient_details.customer_id = auth.uid();

  return p_order_id;
end;
$$;

comment on function set_order_recipient_details(uuid, text, text) is
  'Sets the recipient for the caller''s own unpaid draft order. Called immediately after place_order(); no recipient contact is added to the delivery address visible to all offer-stage riders.';

revoke execute on function set_order_recipient_details(uuid, text, text) from public, anon;
grant execute on function set_order_recipient_details(uuid, text, text) to authenticated;

create or replace function place_order_for_recipient(
  p_cart_id          uuid,
  p_delivery_address jsonb,
  p_delivery_location geography,
  p_delivery_note    text,
  p_recipient_name   text,
  p_recipient_phone  text
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
begin
  if auth.uid() is null then
    raise exception 'place_order_for_recipient: authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  v_order := place_order(p_cart_id, p_delivery_address, p_delivery_location, p_delivery_note);
  perform set_order_recipient_details(v_order.id, p_recipient_name, p_recipient_phone);
  return v_order;
end;
$$;

comment on function place_order_for_recipient(uuid, jsonb, geography, text, text, text) is
  'Calls the existing price-authoritative place_order() and saves the recipient in the same database transaction. If recipient validation or storage fails, the order and cart conversion roll back together.';

revoke execute on function place_order_for_recipient(uuid, jsonb, geography, text, text, text) from public, anon;
grant execute on function place_order_for_recipient(uuid, jsonb, geography, text, text, text) to authenticated;

create or replace function get_order_recipient_details(p_order_id uuid)
returns table (recipient_name text, recipient_phone text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'get_order_recipient_details: authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select r.recipient_name, r.recipient_phone
  from order_recipient_details r
  join orders o on o.id = r.order_id
  where r.order_id = p_order_id and o.customer_id = auth.uid();
end;
$$;

comment on function get_order_recipient_details(uuid) is
  'Returns recipient contact only for the caller''s own order; never accepts an arbitrary customer id.';

revoke execute on function get_order_recipient_details(uuid) from public, anon;
grant execute on function get_order_recipient_details(uuid) to authenticated;

-- The assigned rider keeps the existing contact access boundary: only after
-- acceptance does this function attach recipient contact to its result.
create or replace function public.get_rider_offer_details(p_order_id uuid)
returns table (
  order_code text,
  status text,
  vendor_name text,
  vendor_address_line text,
  vendor_landmark text,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff_lat double precision,
  dropoff_lng double precision,
  delivery_address jsonb,
  delivery_note text,
  item_count integer,
  total_kobo bigint,
  delivery_fee_kobo bigint,
  distance_m integer,
  pickup_distance_m integer,
  rider_fee_estimate_kobo bigint,
  customer_name text,
  customer_phone text
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
  v_recipient          order_recipient_details;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'get_rider_offer_details: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if auth.uid() is null then
    raise exception 'get_rider_offer_details: no authenticated caller';
  end if;

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
  -- An offer-stage rider gets no contact. After assignment, the rider reaches
  -- the gift recipient when one exists, otherwise the customer profile as
  -- before.
  if v_order.rider_id = auth.uid() then
    select * into v_customer_profile from profiles where id = v_order.customer_id;
    select * into v_recipient from order_recipient_details where order_id = v_order.id;
  end if;

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
    coalesce(v_recipient.recipient_name, v_customer_profile.full_name),
    coalesce(v_recipient.recipient_phone, v_customer_profile.phone);
end;
$$;

comment on function public.get_rider_offer_details(uuid) is
  'The assigned rider sees the order recipient (if present), or the customer profile contact. Offer-stage riders do not receive customer/recipient contact. Authorization and result shape match 0076_dispatch_fixes.sql.';

-- Vendor staff already receive customer contact only for their own active,
-- in-flight orders (0077). For a gift order, route that same contact surface
-- to the recipient so stores using their own delivery team can complete it.
create or replace function public.get_vendor_order_customers(p_order_ids uuid[])
returns table (order_id uuid, customer_name text, customer_phone text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'get_vendor_order_customers: no authenticated caller';
  end if;

  perform _assert_active_caller();

  if cardinality(p_order_ids) > 200 then
    raise exception 'get_vendor_order_customers: at most 200 orders per call'
      using errcode = 'check_violation';
  end if;

  return query
  select o.id, coalesce(r.recipient_name, p.full_name), coalesce(r.recipient_phone, p.phone)
  from orders o
  join profiles p on p.id = o.customer_id
  left join order_recipient_details r on r.order_id = o.id
  where o.id = any (p_order_ids)
    and o.status in ('placed', 'accepted', 'preparing', 'ready_for_pickup', 'rider_assigned', 'picked_up', 'in_transit', 'arrived')
    and exists (
      select 1 from vendor_staff vs
      where vs.vendor_id = o.vendor_id and vs.user_id = auth.uid()
    );
end;
$$;

comment on function public.get_vendor_order_customers(uuid[]) is
  'For a vendor''s own in-flight orders, returns recipient name/phone if the buyer marked this as an order for someone else, otherwise the buyer profile contact. Access and lifetime match 0077_input_and_exposure_hardening.sql.';
