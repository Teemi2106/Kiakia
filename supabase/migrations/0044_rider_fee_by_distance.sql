-- KiaKia — pay the rider for the distance THEY actually cover, not the
-- customer's delivery fee.
--
-- Before this migration, verify_delivery_and_release_escrow() (0020/0022/
-- 0025/0031) credited the rider `v_order.delivery_fee_kobo` — the same
-- number the customer was charged for the vendor -> customer leg. Three
-- gaps in that, all independently verified before writing this migration:
--
--   (1) A free-delivery order (subtotal >= service_areas.free_above_kobo)
--       zeroes delivery_fee_kobo entirely (0008/0016/0022's place_order()),
--       so the rider was paid ₦0 for a real delivery. That's a customer-
--       facing promotion; the rider absorbing its cost was never a
--       deliberate decision, just a side effect of reusing one column for
--       two different things.
--   (2) delivery_fee_kobo only ever measured the vendor -> customer leg
--       (orders.distance_m, set once at place_order() time). The rider's
--       OWN trip also includes wherever they are -> the vendor at pickup,
--       which was never paid for at all.
--   (3) Distance-based pay literally could not respond to distance, since
--       the number being paid was fixed at checkout, before any rider was
--       even assigned.
--
-- Fix: a new, independent rider_fee_kobo column, computed in
-- accept_dispatch_offer() — the one moment a specific rider's own location
-- is known, plus the vendor's location and the order's existing
-- vendor->customer distance_m — from a new pair of per-service-area rider
-- rates (rider_base_fee_kobo/rider_per_km_fee_kobo, mirroring
-- base_delivery_fee_kobo/per_km_fee_kobo). verify_delivery_and_release_escrow()
-- is redefined to credit rider_fee_kobo instead of delivery_fee_kobo — one
-- line different from 0031's version, everything else byte-for-byte
-- unchanged. get_rider_offer_details() is redefined to surface a live
-- ESTIMATE of the same number (pickup_distance_m / rider_fee_estimate_kobo)
-- so a rider can see roughly what a trip pays before accepting it — this is
-- explicitly non-authoritative (computed fresh from the rider's current
-- location at read time, not persisted), the authoritative number is
-- whatever accept_dispatch_offer() actually stores at accept time.
--
-- The platform's payout share is still the RESIDUAL (total_kobo - vendor -
-- rider), exactly as 0020 established — decoupling delivery_fee_kobo from
-- rider_fee_kobo does not touch that invariant. The platform now genuinely
-- funds the gap between what the customer paid for delivery and what the
-- rider earned for the trip (most visibly on a free-delivery order, where
-- that gap is the rider's entire fee) — that is the intended, not
-- accidental, effect of this migration.
--
-- SCOPE NOTE — deliberately NOT built here: `st_distance` on a `geography`
-- column is great-circle distance, not road distance, for both the
-- customer-facing delivery fee (unchanged, pre-existing) and this rider
-- fee. Real riding distance is typically 20-40% higher, more across a
-- river or a one-way grid. Fixing that needs a routing API integration —
-- a genuinely separate piece of work, not a formula tweak.

-- ---------------------------------------------------------------------------
-- service_areas.rider_base_fee_kobo / rider_per_km_fee_kobo
-- ---------------------------------------------------------------------------

alter table service_areas
  add column rider_base_fee_kobo  bigint not null default 0 check (rider_base_fee_kobo >= 0),
  add column rider_per_km_fee_kobo bigint not null default 0 check (rider_per_km_fee_kobo >= 0);

comment on column service_areas.rider_base_fee_kobo is
  'Placeholder rate, default 0 — no real rider unit-economics decision exists yet, same honest-placeholder posture as delivery.ts''s SERVICE_FEE_BPS. Set explicitly per service area before launch. Read only by accept_dispatch_offer() (0044) and get_rider_offer_details()''s live estimate.';
comment on column service_areas.rider_per_km_fee_kobo is
  'Placeholder rate, default 0 — see rider_base_fee_kobo''s comment on this table.';

-- These two columns are internal payout economics, not something a
-- customer browsing the app has any legitimate reason to read — unlike
-- base_delivery_fee_kobo/per_km_fee_kobo (customer-facing, intentionally
-- public via 0007's "read active service areas" policy). Column-level
-- REVOKE narrows the blanket `grant select on all tables ... to anon,
-- authenticated` (0034) back down for just these two columns, without
-- touching the table-level policy the customer-facing columns still need.
-- SECURITY DEFINER functions (accept_dispatch_offer, get_rider_offer_details)
-- are unaffected — they read as their owner, not the caller.
revoke select (rider_base_fee_kobo, rider_per_km_fee_kobo) on service_areas from anon, authenticated;

-- ---------------------------------------------------------------------------
-- orders.rider_fee_kobo / rider_pickup_distance_m
-- ---------------------------------------------------------------------------

alter table orders
  add column rider_fee_kobo bigint not null default 0 check (rider_fee_kobo >= 0),
  add column rider_pickup_distance_m integer check (rider_pickup_distance_m >= 0);

comment on column orders.rider_fee_kobo is
  'What the rider is credited on escrow release — independent of delivery_fee_kobo (what the customer paid). Written ONLY by accept_dispatch_offer() (0044_rider_fee_by_distance.sql), from the rider''s own location at accept time; 0 until a rider accepts. Read by verify_delivery_and_release_escrow() in place of delivery_fee_kobo as of this migration.';
comment on column orders.rider_pickup_distance_m is
  'Rider''s own location -> vendor, at accept_dispatch_offer() time (great-circle, see this migration''s scope note). NULL until a rider accepts. Stored alongside the pre-existing distance_m (vendor -> customer) purely for audit/support visibility into how rider_fee_kobo was derived — not read by any function.';

-- ---------------------------------------------------------------------------
-- accept_dispatch_offer() — redefined to also compute and store
-- rider_fee_kobo/rider_pickup_distance_m. Every other check (row lock,
-- ready_for_pickup/rider_id-null, kyc_status re-check, offer lookup, expiry
-- check, transition-table check, the order_events insert, and the
-- "expire every other rider's offer" step) is byte-for-byte unchanged from
-- 0028_dispatch_offer_lifecycle.sql — see that migration and
-- 0019/0023's own headers for the full reasoning behind each of those.
-- ---------------------------------------------------------------------------

create or replace function accept_dispatch_offer(p_order_id uuid)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order                   orders;
  v_offer                   dispatch_offers;
  v_vendor_location         geography(point, 4326);
  v_rider_location          geography(point, 4326);
  v_area                    service_areas;
  v_pickup_distance_m       double precision;
  v_rider_fee_kobo          bigint;
begin
  -- Lock the row first — same reasoning as transition_order()'s own first
  -- step: this is also what makes two riders racing to accept the same
  -- offer serialize instead of racing. Unchanged from 0019/0023/0028.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'accept_dispatch_offer: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if v_order.status <> 'ready_for_pickup' or v_order.rider_id is not null then
    raise exception 'accept_dispatch_offer: order already assigned or not ready for pickup';
  end if;

  -- Unchanged from 0023 (BLOCKING 4): check the CALLER's own current
  -- kyc_status, not just trust that only kyc-approved riders were ever
  -- offered.
  if not exists (
    select 1 from riders where user_id = auth.uid() and kyc_status = 'approved'
  ) then
    raise exception 'accept_dispatch_offer: rider is not kyc-approved';
  end if;

  select * into v_offer
  from dispatch_offers
  where order_id = p_order_id and rider_id = auth.uid() and status = 'offered';

  if not found then
    raise exception 'accept_dispatch_offer: no active offer for this rider on this order';
  end if;

  -- Unchanged from 0028: an offer past its TTL is no longer acceptable,
  -- flipped to 'expired' lazily here since no scheduled sweep exists yet
  -- (see 0028's file header).
  if v_offer.expires_at <= now() then
    update dispatch_offers
    set status = 'expired', responded_at = now()
    where order_id = p_order_id and rider_id = auth.uid() and status = 'offered';

    raise exception 'accept_dispatch_offer: offer has expired';
  end if;

  -- Defensive, mirrors transition_order()'s own style: don't skip the
  -- explicit allowed-transitions check even though this specific edge is
  -- known to exist in order_status_transitions (0006_transition_order.sql).
  -- Unchanged from 0019/0023/0028.
  if not exists (
    select 1 from order_status_transitions
    where from_status = 'ready_for_pickup' and to_status = 'rider_assigned'
  ) then
    raise exception 'accept_dispatch_offer: ready_for_pickup -> rider_assigned is not a legal transition';
  end if;

  -- NEW in this migration: compute rider_fee_kobo from the rider's OWN
  -- distance, now that we finally know which rider is accepting.
  --
  -- The dispatch trigger (0023) already required current_location is not
  -- null and kyc_status = 'approved' to have offered this rider in the
  -- first place, so both should be set here too in the overwhelmingly
  -- common case — but a rider's location is periodically refreshed
  -- (update_rider_location(), 0026), not guaranteed fresh at the exact
  -- instant of accept, so this is checked again rather than assumed.
  -- Raising here (rather than silently defaulting to a 0 rider fee) mirrors
  -- place_order()'s own posture on a location-less vendor: a genuinely
  -- exceptional precondition, not a value to paper over with a placeholder.
  select current_location into v_rider_location from riders where user_id = auth.uid();
  if v_rider_location is null then
    raise exception 'accept_dispatch_offer: rider has no current_location set, cannot compute rider fee';
  end if;

  select location into v_vendor_location from vendors where id = v_order.vendor_id;
  if v_vendor_location is null then
    raise exception 'accept_dispatch_offer: vendor has no location set, cannot compute rider fee';
  end if;

  -- place_order() (0016/0022) never places an order outside an active
  -- service area, so v_order.service_area_id is always set for a real
  -- order — checked anyway, same defensive-redundancy style as the
  -- transitions-table check just above.
  if v_order.service_area_id is null then
    raise exception 'accept_dispatch_offer: order % has no service_area_id, cannot compute rider fee', p_order_id;
  end if;

  select * into v_area from service_areas where id = v_order.service_area_id;
  if not found then
    raise exception 'accept_dispatch_offer: service area % does not exist', v_order.service_area_id;
  end if;

  v_pickup_distance_m := st_distance(v_rider_location, v_vendor_location);

  -- base + per_km * ceil((pickup_leg + dropoff_leg) / 1000) — mirrored in
  -- TS as computeRiderFee() in packages/domain/src/delivery.ts. dropoff_leg
  -- is the order's own distance_m (vendor -> customer, set at place_order()
  -- time); coalesced to 0 defensively even though it is practically always
  -- set by place_order().
  v_rider_fee_kobo := v_area.rider_base_fee_kobo
    + v_area.rider_per_km_fee_kobo * ceil((v_pickup_distance_m + coalesce(v_order.distance_m, 0)) / 1000.0)::bigint;

  update orders
  set rider_id = auth.uid(),
      status = 'rider_assigned',
      assigned_at = now(),
      rider_fee_kobo = v_rider_fee_kobo,
      rider_pickup_distance_m = round(v_pickup_distance_m)
  where id = p_order_id
  returning * into v_order;

  -- Mirrors transition_order()'s own order_events insert shape exactly.
  -- Unchanged from 0019/0023/0028.
  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (p_order_id, 'ready_for_pickup', 'rider_assigned', 'rider', auth.uid(), '{}'::jsonb);

  update dispatch_offers
  set status = 'accepted', responded_at = now()
  where order_id = p_order_id and rider_id = auth.uid();

  -- Same race-safety guarantee as 0019/0023/0028: once the row lock above
  -- is released by this transaction's commit, orders.rider_id is no longer
  -- null, so any concurrent/later accept attempt by a different rider fails
  -- the ready_for_pickup/rider_id-null check at the top, regardless of
  -- whether that rider's own offer row is still 'offered' or has expired.
  update dispatch_offers
  set status = 'expired', responded_at = now()
  where order_id = p_order_id and rider_id <> auth.uid() and status = 'offered';

  return v_order;
end;
$$;

comment on function accept_dispatch_offer(uuid) is
  'The only way a dispatch offer becomes an assignment, and (as of 0044) the only writer of orders.rider_fee_kobo/rider_pickup_distance_m. Deliberately not routed through transition_order() — see 0019_rider_dispatch.sql''s file header. Gated by: an ''offered'' row for the caller that has not yet passed expires_at (0028), ready_for_pickup/rider_id-null on the order, and kyc_status = ''approved'' on the caller''s own live riders row (0023). Computes rider_fee_kobo from the rider''s own current_location -> vendor distance plus the order''s existing vendor->customer distance_m, against service_areas.rider_base_fee_kobo/rider_per_km_fee_kobo (0044) — raises if the rider''s location, the vendor''s location, or the order''s service area is missing, rather than silently paying 0. No re-dispatch sweep exists yet for orders whose only offers all expire/decline — see 0028''s file header for that scope note.';

revoke execute on function accept_dispatch_offer(uuid) from public;
grant execute on function accept_dispatch_offer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- verify_delivery_and_release_escrow() — redefined ONLY to credit
-- rider_fee_kobo instead of delivery_fee_kobo. Every other check (row lock,
-- actor check, idempotency-first ordering, arrived/paid checks, the
-- reset-marker-aware rate limit, the delivery-code check, the escrow-held
-- re-derivation, the vendor-split math) is reproduced byte-for-byte from
-- 0031_refund_and_escrow_unwind.sql.
-- ---------------------------------------------------------------------------

create or replace function verify_delivery_and_release_escrow(
  p_order_id      uuid,
  p_delivery_code text
)
returns delivery_verification_result
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
  v_reset_marker_at     timestamptz;
  v_result              delivery_verification_result;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'verify_delivery_and_release_escrow: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if auth.uid() is null or v_order.rider_id is null or auth.uid() is distinct from v_order.rider_id then
    raise exception 'verify_delivery_and_release_escrow: actor is not the assigned rider on order %', p_order_id;
  end if;

  v_reference := v_order.code || '-escrow';

  if exists (select 1 from transactions where reference = v_reference) then
    select * into v_order from orders where id = p_order_id;
    v_result.code_matched := true;
    v_result.order_row := v_order;
    return v_result;
  end if;

  if v_order.status <> 'arrived' then
    raise exception 'verify_delivery_and_release_escrow: order is not yet marked arrived (status=%)', v_order.status;
  end if;

  if v_order.payment_status <> 'paid' then
    raise exception 'verify_delivery_and_release_escrow: order % payment_status is not paid (status=%)',
      p_order_id, v_order.payment_status;
  end if;

  select max(at) into v_reset_marker_at
  from order_events
  where order_id = p_order_id
    and (meta ->> 'delivery_code_attempts_reset')::boolean is true;

  select count(*) into v_failed_attempts
  from order_events
  where order_id = p_order_id
    and (meta ->> 'delivery_code_failed')::boolean is true
    and at >= v_order.arrived_at
    and at > coalesce(v_reset_marker_at, '-infinity'::timestamptz);

  if v_failed_attempts >= 5 then
    raise exception 'verify_delivery_and_release_escrow: too many incorrect delivery-code attempts for order %', p_order_id;
  end if;

  select code into v_stored_code from order_delivery_codes where order_id = p_order_id;
  if v_stored_code is null then
    raise exception 'verify_delivery_and_release_escrow: no delivery code exists for order %', p_order_id;
  end if;

  if p_delivery_code is distinct from v_stored_code then
    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (p_order_id, v_order.status, v_order.status, 'rider', auth.uid(), jsonb_build_object('delivery_code_failed', true));

    v_result.code_matched := false;
    v_result.order_row := v_order;
    return v_result;
  end if;

  select * into v_vendor from vendors where id = v_order.vendor_id;
  if not found then
    raise exception 'verify_delivery_and_release_escrow: vendor % does not exist', v_order.vendor_id;
  end if;

  select id into v_escrow_account_id from accounts where owner_type = 'platform' and owner_id is null and kind = 'escrow';
  if v_escrow_account_id is null then
    raise exception 'verify_delivery_and_release_escrow: platform escrow account is not seeded';
  end if;

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

  -- THIS MIGRATION's change: v_rider_kobo now comes from rider_fee_kobo
  -- (set by accept_dispatch_offer(), 0044) instead of delivery_fee_kobo —
  -- see this migration's file header for why the two were conflated
  -- before. v_platform_kobo remains the RESIDUAL (total_kobo - vendor -
  -- rider), unchanged from 0020: this is what makes a free-delivery order
  -- (delivery_fee_kobo = 0, but rider_fee_kobo > 0) still balance — the
  -- platform's share simply absorbs the difference, exactly as it already
  -- absorbs discount_kobo.
  v_commission_kobo := round(v_order.subtotal_kobo * v_vendor.commission_bps / 10000.0)::bigint;
  v_vendor_kobo := v_order.subtotal_kobo - v_commission_kobo;
  v_rider_kobo := v_order.rider_fee_kobo;
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

  v_order := transition_order(p_order_id, 'delivered', 'rider', auth.uid(), jsonb_build_object('delivery_code_verified', true));
  v_result.code_matched := true;
  v_result.order_row := v_order;
  return v_result;
end;
$$;

comment on function verify_delivery_and_release_escrow(uuid, text) is
  'The only writer of escrow_release ledger entries and the only path from arrived to delivered. Only the assigned rider may call it; idempotent on retry via the "<order.code>-escrow" transactions.reference anchor. Reads the delivery code from order_delivery_codes (0022), refuses to release unless escrow actually holds exactly total_kobo (0022 BLOCKING 2), requires payment_status=paid (0022 SHOULD-FIX 5), and rate-limits failed attempts to 5 within a window starting at the LATER of arrived_at or the most recent admin_reset_delivery_code_attempts() marker (0022 SHOULD-FIX 7, made actually effective by 0025, resettable by an admin as of 0031). As of 0044, the rider''s payout share comes from orders.rider_fee_kobo (set by accept_dispatch_offer()) instead of delivery_fee_kobo — see 0044''s file header. Returns delivery_verification_result (code_matched, order_row): a wrong code is a NORMAL non-raising result as of 0025, not an exception. See 0020 for the payout-split reasoning, 0022/0025 for everything else, 0031 for the reset-window change, and 0044 for the rider-fee change.';

revoke execute on function verify_delivery_and_release_escrow(uuid, text) from public;
grant execute on function verify_delivery_and_release_escrow(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_rider_offer_details() — redefined to also surface a live ESTIMATE of
-- what accepting would pay: pickup_distance_m and rider_fee_estimate_kobo.
-- Deliberately non-authoritative and NULL-tolerant (unlike
-- accept_dispatch_offer(), which raises when data is missing) — this is a
-- read a rider uses to decide whether to accept, it must never fail just
-- because e.g. the vendor hasn't set a location yet. The authoritative
-- number is whatever accept_dispatch_offer() actually stores at accept
-- time; this can differ if the rider's location changes between reading
-- this and accepting. Every existing check (authorization via a live
-- 'offered'/'accepted' dispatch_offers row or being the assigned rider,
-- the auth.uid() is null guard, the returned column shape otherwise) is
-- unchanged from 0032_vendor_location_and_rider_reads.sql.
--
-- `create or replace` cannot widen a function's OUT-parameter row type
-- (Postgres error 42P13: "cannot change return type of existing function"),
-- so the old 0032 definition must be dropped first — same reasoning as
-- 0045_customer_wallet.sql's drop-then-create for
-- _unwind_order_escrow_ledger()/refund_order_escrow().
-- ---------------------------------------------------------------------------

drop function if exists get_rider_offer_details(uuid);

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

  if not exists (
    select 1 from dispatch_offers
    where order_id = p_order_id and rider_id = auth.uid() and status in ('offered', 'accepted')
  ) and auth.uid() is distinct from v_order.rider_id then
    raise exception 'get_rider_offer_details: actor % has no active offer or assignment on order %', auth.uid(), p_order_id;
  end if;

  select * into v_vendor from vendors where id = v_order.vendor_id;

  -- NEW in this migration: best-effort live estimate. Left NULL (never
  -- raised) whenever any input it needs is missing — the caller's own
  -- current_location, the vendor's location, or the order's service area
  -- rates — since this is advisory only.
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
  'Lets a rider see what a dispatch offer is FOR before deciding whether to accept it, and lets the assigned rider re-read the same details afterward. Deliberately NOT `returns orders` — see 0032''s own header for why. As of 0044, also returns pickup_distance_m/rider_fee_estimate_kobo: a live, non-authoritative estimate of what accepting would pay, NULL whenever the rider''s own location, the vendor''s location, or the order''s service area rates are missing (never raises for this part — it is advisory only). The authoritative rider_fee_kobo is set by accept_dispatch_offer() at accept time and can differ if the rider''s location changes in between. Authorization unchanged from 0032: a live ''offered''/''accepted'' dispatch_offers row, or already being the assigned rider, re-checked on every call.';

revoke execute on function get_rider_offer_details(uuid) from public;
grant execute on function get_rider_offer_details(uuid) to authenticated;
