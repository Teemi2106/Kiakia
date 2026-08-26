-- KiaKia — independent security review (round 3), BLOCKING findings 1 & 2,
-- plus SHOULD-FIX 5, 6, 7. All four live in the same tight cluster (the
-- delivery-code anti-fraud gate and the escrow release it triggers), so
-- they're fixed together in one migration rather than forcing
-- verify_delivery_and_release_escrow() to be redefined twice.
--
-- BLOCKING 1 — the delivery_code anti-fraud mechanism was completely void:
-- the rider could read it before ever meeting the customer. `orders` is
-- returned in full by every SECURITY DEFINER function that `returns orders`
-- (accept_dispatch_offer, transition_order, capture_payment, place_order —
-- all run as the function owner and bypass column-level grants entirely,
-- so a `revoke select (delivery_code) on orders from authenticated` would
-- have done nothing), and the "assigned rider reads that order" RLS policy
-- (0007_rls.sql) lets the rider `SELECT` the column directly too. Fix:
-- delivery_code moves out of `orders` entirely into its own table with its
-- own RLS policy that names the customer specifically and nobody else —
-- not the rider (the exact adversary this code exists to stop), not vendor
-- staff. The column is dropped outright; there is no production data to
-- migrate (pre-launch).
--
-- BLOCKING 2 — verify_delivery_and_release_escrow() debited escrow for
-- total_kobo unconditionally, but capture_payment() (0017) allows an amount
-- MISMATCH to still succeed (it warns and flags order_events, but credits
-- escrow with whatever was actually paid, not total_kobo). If those ever
-- diverge, releasing total_kobo would release money that was never
-- actually captured. Fix: re-derive what escrow actually holds for this
-- order from ledger_entries before computing the payout split, and refuse
-- to release if it doesn't exactly equal total_kobo.
--
-- SHOULD-FIX 5 — payment_status = 'paid' was never checked before release.
-- SHOULD-FIX 6 — `p_delivery_code is distinct from v_order.delivery_code`
-- treated a code-less order (both sides NULL) as a pass. Explicit raise if
-- no order_delivery_codes row exists.
-- SHOULD-FIX 7 — no rate-limiting on delivery-code guesses, despite the
-- assigned rider being exactly the adversary this code exists to stop.
-- Fix: flag each failed attempt on order_events (same "append an event with
-- a meta payload" convention as 0017's amount_mismatch/duplicate_capture_
-- attempt flags), and refuse past 5 failed attempts since arrived_at.

-- ---------------------------------------------------------------------------
-- order_delivery_codes — replaces orders.delivery_code.
-- ---------------------------------------------------------------------------

create table order_delivery_codes (
  order_id    uuid primary key references orders (id),
  code        text not null,
  created_at  timestamptz not null default now()
);

comment on table order_delivery_codes is
  'The 4-digit rider-handover code (formerly orders.delivery_code, moved out entirely by this migration — independent security review, round 3, blocking finding 1). Written only by place_order(). RLS below scopes SELECT to the order''s own customer ONLY — never the assigned rider (the adversary this code exists to stop) and never vendor staff, which is exactly what a plain column on `orders` could never achieve since every SECURITY DEFINER function that `returns orders` bypasses column-level grants as the function owner.';

alter table order_delivery_codes enable row level security;

create policy "customer reads own order's delivery code" on order_delivery_codes for select
  using (exists (
    select 1 from orders o where o.id = order_delivery_codes.order_id and o.customer_id = auth.uid()
  ));

-- No insert/update/delete grant for `authenticated` at all — written only by
-- place_order() (SECURITY DEFINER, below), same posture as dispatch_offers.
revoke insert, update, delete on order_delivery_codes from authenticated;

-- ---------------------------------------------------------------------------
-- place_order() — redefined to insert into order_delivery_codes instead of
-- setting orders.delivery_code. Everything else is unchanged from
-- 0016_fix_place_order_pricing_scope.sql.
-- ---------------------------------------------------------------------------

create or replace function place_order(
  p_cart_id           uuid,
  p_delivery_address  jsonb,
  p_delivery_location geography(point, 4326),
  p_delivery_note     text default null
)
returns orders
language plpgsql
security definer
-- See 0016's own header for why `extensions` must be on this narrow
-- search_path alongside `public` — gen_random_bytes() below is pgcrypto's,
-- installed into `extensions` on Supabase, not `public`.
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

  if v_area.free_above_kobo is not null and v_subtotal_kobo >= v_area.free_above_kobo then
    v_delivery_fee_kobo := 0;
  else
    v_delivery_fee_kobo := v_area.base_delivery_fee_kobo + v_area.per_km_fee_kobo * ceil(v_distance_m / 1000.0)::bigint;
  end if;

  v_service_fee_kobo := round(v_subtotal_kobo * 200 / 10000.0); -- SERVICE_FEE_BPS = 200
  v_total_kobo := v_subtotal_kobo + v_delivery_fee_kobo + v_service_fee_kobo;

  -- delivery_code no longer inserted here — see order_delivery_codes insert
  -- below, this migration's fix.
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

  -- The cryptographically-random 4-digit code (pgcrypto's gen_random_bytes,
  -- same generator as 0016), now written to order_delivery_codes instead of
  -- orders.delivery_code — this migration's fix (blocking finding 1).
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
  'The only writer of the orders/order_items INSERT path, and of order_delivery_codes (this migration). Mirrors packages/domain/src/delivery.ts — keep both in sync. Pricing joins are vendor/menu-item-scoped and min_order_kobo is enforced server-side — see 0016_fix_place_order_pricing_scope.sql. The delivery code is written to order_delivery_codes, never to orders — see 0022_delivery_code_off_orders.sql.';

revoke execute on function place_order(uuid, jsonb, geography, text) from public;
grant execute on function place_order(uuid, jsonb, geography, text) to authenticated;

-- ---------------------------------------------------------------------------
-- orders.delivery_code — dropped. No production data to migrate
-- (pre-launch); every reader has been moved to order_delivery_codes
-- (this migration, TypeScript call sites updated in the same round).
-- ---------------------------------------------------------------------------

alter table orders drop column delivery_code;

-- ---------------------------------------------------------------------------
-- verify_delivery_and_release_escrow() — redefined for BLOCKING 2 (escrow-
-- held verification) and SHOULD-FIX 5/6/7 (payment_status check, missing-
-- code raise, rate-limited attempts) on top of BLOCKING 1 (reading the code
-- from order_delivery_codes instead of orders.delivery_code). The
-- idempotency-first ordering, the actor-authorization check, and the
-- payout-split math are UNCHANGED from 0020 (all three independently
-- reviewed and confirmed correct already) — only the additions below are
-- new.
-- ---------------------------------------------------------------------------

create or replace function verify_delivery_and_release_escrow(
  p_order_id      uuid,
  p_delivery_code text
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order               orders;
  v_vendor              vendors;
  v_commission_kobo     bigint;
  v_vendor_kobo         bigint;
  v_rider_kobo          bigint;
  v_platform_kobo       bigint;
  v_vendor_account_id   uuid;
  v_rider_account_id    uuid;
  v_escrow_account_id   uuid;
  v_revenue_account_id  uuid;
  v_transaction_id      uuid;
  v_reference           text;
  v_stored_code         text;
  v_failed_attempts     integer;
  v_escrow_held_kobo    bigint;
begin
  -- 1. Lock the row — same reasoning as transition_order()'s own first step.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'verify_delivery_and_release_escrow: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- 2. Only the assigned rider may do this.
  if auth.uid() is null or v_order.rider_id is null or auth.uid() is distinct from v_order.rider_id then
    raise exception 'verify_delivery_and_release_escrow: actor is not the assigned rider on order %', p_order_id;
  end if;

  v_reference := v_order.code || '-escrow';

  -- 3. Idempotency FIRST — UNCHANGED from 0020, see that migration's own
  --    comment for why this must stay ahead of the status/code checks below.
  if exists (select 1 from transactions where reference = v_reference) then
    select * into v_order from orders where id = p_order_id;
    return v_order;
  end if;

  -- 4. Must be 'arrived' — don't silently allow verifying from an earlier
  --    status.
  if v_order.status <> 'arrived' then
    raise exception 'verify_delivery_and_release_escrow: order is not yet marked arrived (status=%)', v_order.status;
  end if;

  -- SHOULD-FIX 5 (independent security review, round 3): payment_status
  -- must be 'paid' before any release — status='arrived' alone doesn't
  -- prove the order was ever actually captured.
  if v_order.payment_status <> 'paid' then
    raise exception 'verify_delivery_and_release_escrow: order % payment_status is not paid (status=%)',
      p_order_id, v_order.payment_status;
  end if;

  -- SHOULD-FIX 7 (independent security review, round 3): rate-limit
  -- delivery-code guesses. The assigned rider is exactly the adversary this
  -- code exists to stop, and an unlimited number of guesses is trivially
  -- scriptable. Counted from arrived_at so a rider re-attempting on a later,
  -- unrelated delivery never inherits an earlier order's failure count (this
  -- column and table are per-order already, but arrived_at anchors the
  -- window to this specific handover attempt).
  select count(*) into v_failed_attempts
  from order_events
  where order_id = p_order_id
    and (meta ->> 'delivery_code_failed')::boolean is true
    and at >= v_order.arrived_at;

  if v_failed_attempts >= 5 then
    raise exception 'verify_delivery_and_release_escrow: too many incorrect delivery-code attempts for order %', p_order_id;
  end if;

  -- SHOULD-FIX 6 (independent security review, round 3): the old
  -- `p_delivery_code is distinct from v_order.delivery_code` comparison
  -- treated a code-less order (both NULL) as a pass, since
  -- `null is distinct from null` is false. Explicitly raise if no code was
  -- ever generated for this order rather than let a NULL-vs-NULL comparison
  -- silently succeed.
  select code into v_stored_code from order_delivery_codes where order_id = p_order_id;
  if v_stored_code is null then
    raise exception 'verify_delivery_and_release_escrow: no delivery code exists for order %', p_order_id;
  end if;

  -- 5. The code itself — read from order_delivery_codes (BLOCKING 1,
  --    0022_delivery_code_off_orders.sql), never orders.delivery_code (that
  --    column no longer exists). Never reveal the correct code in the
  --    error. A wrong guess is now recorded on order_events (SHOULD-FIX 7)
  --    before raising, so the rate limit above actually has something to
  --    count.
  if p_delivery_code is distinct from v_stored_code then
    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (p_order_id, v_order.status, v_order.status, 'rider', auth.uid(), jsonb_build_object('delivery_code_failed', true));

    raise exception 'verify_delivery_and_release_escrow: incorrect delivery code';
  end if;

  select * into v_vendor from vendors where id = v_order.vendor_id;
  if not found then
    raise exception 'verify_delivery_and_release_escrow: vendor % does not exist', v_order.vendor_id;
  end if;

  -- Platform escrow — pre-seeded in 0010_capture_payment.sql. Looked up here
  -- (earlier than 0020 did) because BLOCKING 2's escrow-held check below
  -- needs it before the payout split is computed, not just at debit time.
  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';
  if v_escrow_account_id is null then
    raise exception 'verify_delivery_and_release_escrow: platform escrow account is not seeded';
  end if;

  -- BLOCKING 2 (independent security review, round 3): capture_payment()
  -- (0017) allows an amount MISMATCH to still succeed — it credits escrow
  -- with whatever was actually paid (p_amount_kobo), not total_kobo. Nothing
  -- before this migration guaranteed escrow actually holds total_kobo for
  -- this order; debiting that amount unconditionally could release money
  -- that was never actually captured. Re-derive what escrow actually holds
  -- and refuse to release rather than guessing.
  select coalesce(sum(amount_kobo), 0) into v_escrow_held_kobo
  from ledger_entries
  where order_id = p_order_id
    and account_id = v_escrow_account_id
    and direction = 'credit'
    and entry_type = 'payment_capture';

  if v_escrow_held_kobo <> v_order.total_kobo then
    raise exception 'verify_delivery_and_release_escrow: escrow for order % holds % kobo but total_kobo is % — refusing to release',
      p_order_id, v_escrow_held_kobo, v_order.total_kobo;
  end if;

  -- The payout split — UNCHANGED from 0020 (independently reviewed and
  -- confirmed exact). v_platform_kobo is deliberately the residual; see
  -- 0020's own comment for the full reasoning.
  v_commission_kobo := round(v_order.subtotal_kobo * v_vendor.commission_bps / 10000.0)::bigint;
  v_vendor_kobo := v_order.subtotal_kobo - v_commission_kobo;
  v_rider_kobo := v_order.delivery_fee_kobo;
  v_platform_kobo := v_order.total_kobo - v_vendor_kobo - v_rider_kobo;

  if v_vendor_kobo < 0 or v_rider_kobo < 0 or v_platform_kobo < 0 then
    raise exception 'verify_delivery_and_release_escrow: computed a negative payout share for order % (vendor=%, rider=%, platform=%) — refusing to release',
      p_order_id, v_vendor_kobo, v_rider_kobo, v_platform_kobo;
  end if;

  select id into v_vendor_account_id from accounts where owner_type = 'vendor' and owner_id = v_order.vendor_id and kind = 'available';
  if v_vendor_account_id is null then
    insert into accounts (owner_type, owner_id, kind) values ('vendor', v_order.vendor_id, 'available')
    on conflict (owner_type, owner_id, kind) do nothing;
    select id into v_vendor_account_id from accounts where owner_type = 'vendor' and owner_id = v_order.vendor_id and kind = 'available';
  end if;

  select id into v_rider_account_id from accounts where owner_type = 'rider' and owner_id = v_order.rider_id and kind = 'available';
  if v_rider_account_id is null then
    insert into accounts (owner_type, owner_id, kind) values ('rider', v_order.rider_id, 'available')
    on conflict (owner_type, owner_id, kind) do nothing;
    select id into v_rider_account_id from accounts where owner_type = 'rider' and owner_id = v_order.rider_id and kind = 'available';
  end if;

  select id into v_revenue_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'revenue';
  if v_revenue_account_id is null then
    raise exception 'verify_delivery_and_release_escrow: platform revenue account is not seeded';
  end if;

  insert into transactions (kind, reference, order_id, description)
  values ('escrow_release', v_reference, p_order_id, 'Escrow released on delivery-code verification')
  returning id into v_transaction_id;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  values (v_transaction_id, v_escrow_account_id, 'debit', v_order.total_kobo, 'escrow_release', p_order_id);

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_vendor_account_id, 'credit', v_vendor_kobo, 'escrow_release', p_order_id
  where v_vendor_kobo > 0;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_rider_account_id, 'credit', v_rider_kobo, 'escrow_release', p_order_id
  where v_rider_kobo > 0;

  insert into ledger_entries (transaction_id, account_id, direction, amount_kobo, entry_type, order_id)
  select v_transaction_id, v_revenue_account_id, 'credit', v_platform_kobo, 'escrow_release', p_order_id
  where v_platform_kobo > 0;

  return transition_order(p_order_id, 'delivered', 'rider', auth.uid(), jsonb_build_object('delivery_code_verified', true));
end;
$$;

comment on function verify_delivery_and_release_escrow(uuid, text) is
  'The only writer of escrow_release ledger entries and the only path from arrived to delivered. Only the assigned rider may call it; idempotent on retry via the "<order.code>-escrow" transactions.reference anchor. Reads the delivery code from order_delivery_codes (0022), refuses to release unless escrow actually holds exactly total_kobo (0022 BLOCKING 2), requires payment_status=paid (0022 SHOULD-FIX 5), and rate-limits failed attempts to 5 per arrived_at window (0022 SHOULD-FIX 7). See 0020_verify_delivery_and_release_escrow.sql for the payout-split reasoning and 0022_delivery_code_off_orders.sql for everything added on top.';

revoke execute on function verify_delivery_and_release_escrow(uuid, text) from public;
grant execute on function verify_delivery_and_release_escrow(uuid, text) to authenticated;
