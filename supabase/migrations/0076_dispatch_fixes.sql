-- KiaKia - dispatch defects found by end-to-end QA against the live project.
--
--   1. Expired offers were never re-offered. dispatch_offers is unique on
--      (order_id, rider_id) and every dispatch path inserted with ON CONFLICT
--      DO NOTHING, so a rider whose 2 minute window lapsed could never be
--      asked again and 0067's cycle logic was dead code. The offer is now
--      RE-OPENED (expired -> offered, fresh TTL) by an upsert that touches only
--      'expired' rows; declined and accepted rows are never resurrected. A new
--      trigger pushes the re-opened offer, since the existing one is INSERT-only.
--   2. A rider far from the vendor could accept an order whose fee could not
--      cover them, complete the delivery, and jam release ("negative payout
--      share"). _max_rider_fee_kobo() is the most the order can fund
--      (total - vendor share, the exact arithmetic release uses); riders whose
--      fee would exceed it are not offered the order, and accept refuses them.
--      accept now also requires the rider to be online with a ping under 5
--      minutes old, since the fee is frozen from that position.
--   3. The ready_for_pickup trigger and the early sweep had no staleness guard
--      (only the periodic sweep did), so orders were offered to riders who had
--      gone offline. All three paths now share one function,
--      _dispatch_offer_batch(), so eligibility, the fee cap and the upsert
--      cannot drift apart again.
--   4. A vendor with no location left an order at ready_for_pickup forever: the
--      sweep hit `continue` before the 30 minute give-up. Location-less orders
--      now flow through the same exhaustion and give-up path as any other.
--   5. get_rider_offer_details() returned the customer's phone to any rider
--      holding an unaccepted offer. Now only the assigned rider.
--
-- Also here, for scale: the sweeps run every 15s/60s, so their scans are backed
-- by small partial indexes (offers awaiting expiry, orders awaiting a rider),
-- and the nearest-rider pick orders by the GiST KNN operator instead of
-- sorting every online rider by st_distance.
--
-- accept_dispatch_offer() and get_rider_offer_details() are reproduced from
-- their LIVE definitions with only the changes described above.

create function _dispatch_offer_ttl()
returns interval
language sql
immutable
parallel safe
as $$ select interval '120 seconds' $$;

comment on function _dispatch_offer_ttl() is
  'Single source for how long a dispatch offer stays live. Used by the dispatch_offers.expires_at default and by the re-open path in _dispatch_offer_batch(); change it here only.';

alter table dispatch_offers alter column expires_at set default (now() + _dispatch_offer_ttl());

create index dispatch_offers_live_expiry_idx on dispatch_offers (expires_at) where status = 'offered';
create index orders_awaiting_rider_idx on orders (ready_at) where status = 'ready_for_pickup' and rider_id is null;
create index orders_awaiting_early_dispatch_idx on orders (accepted_at) where status in ('accepted', 'preparing') and rider_id is null;

-- ---------------------------------------------------------------------------
-- _max_rider_fee_kobo(): the most an order can pay a rider
-- ---------------------------------------------------------------------------

create function _max_rider_fee_kobo(p_order_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  -- Same arithmetic as verify_delivery_and_release_escrow(): platform share =
  -- total - vendor share - rider fee must not go negative.
  select o.total_kobo - (o.subtotal_kobo - round(o.subtotal_kobo * v.commission_bps / 10000.0)::bigint)
  from orders o
  join vendors v on v.id = o.vendor_id
  where o.id = p_order_id
$$;

comment on function _max_rider_fee_kobo(uuid) is
  'Largest rider_fee_kobo an order can fund: total_kobo minus the vendor payout (subtotal less commission, rounded exactly as verify_delivery_and_release_escrow() rounds it). NULL for an unknown order. Internal.';

revoke all on function _max_rider_fee_kobo(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- _dispatch_offer_batch(): the one place that decides who is offered an order
-- ---------------------------------------------------------------------------

create function _dispatch_offer_batch(
  p_order_id         uuid,
  p_cycle_started_at timestamptz,
  p_batch_size       integer default 10
)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order           orders;
  v_vendor_location geography(point, 4326);
  v_area            service_areas;
  v_max_rider_fee   bigint;
  v_offered         integer;
begin
  select * into v_order from orders where id = p_order_id;
  if not found or v_order.service_area_id is null then
    return 0;
  end if;

  select location into v_vendor_location from vendors where id = v_order.vendor_id;
  if v_vendor_location is null then
    return 0;
  end if;

  select * into v_area from service_areas where id = v_order.service_area_id;
  if not found then
    return 0;
  end if;

  v_max_rider_fee := _max_rider_fee_kobo(p_order_id);

  -- Closest first, no distance cap (0066), but only riders who are really
  -- available (online, approved, pinged in the last 5 minutes) and whose fee
  -- the order can actually fund. A rider is skipped if they declined, already
  -- hold a live or accepted offer, or were already asked in the current cycle;
  -- one whose earlier offer merely EXPIRED (and was not asked this cycle) is
  -- re-opened rather than skipped forever.
  insert into dispatch_offers (order_id, rider_id)
  select p_order_id, r.user_id
  from riders r
  where r.is_online
    and r.kyc_status = 'approved'
    and r.current_location is not null
    and r.last_ping_at >= now() - interval '5 minutes'
    and v_area.rider_base_fee_kobo
        + v_area.rider_per_km_fee_kobo
          * ceil((st_distance(r.current_location, v_vendor_location) + coalesce(v_order.distance_m, 0)) / 1000.0)::bigint
        <= v_max_rider_fee
    and not exists (
      select 1 from dispatch_offers d
      where d.order_id = p_order_id
        and d.rider_id = r.user_id
        and (d.status in ('declined', 'accepted', 'offered') or d.offered_at >= p_cycle_started_at)
    )
  order by r.current_location <-> v_vendor_location
  limit p_batch_size
  on conflict (order_id, rider_id) do update
    set status       = 'offered',
        offered_at   = now(),
        expires_at   = now() + _dispatch_offer_ttl(),
        responded_at = null
    where dispatch_offers.status = 'expired';

  get diagnostics v_offered = row_count;
  return v_offered;
end;
$function$;

comment on function _dispatch_offer_batch(uuid, timestamptz, integer) is
  'Offers an order to the nearest eligible riders and returns how many offers were created or re-opened. Shared by the ready_for_pickup trigger, the early-dispatch sweep and the re-dispatch sweep so eligibility (online, KYC approved, ping under 5 minutes, fee within _max_rider_fee_kobo), cycle exclusion and the expired-offer re-open live in exactly one place. Returns 0 for an order with no vendor location or service area. Internal.';

revoke all on function _dispatch_offer_batch(uuid, timestamptz, integer) from public, anon, authenticated, service_role;

-- A re-opened offer is an UPDATE, not an INSERT, so it needs its own push.
create trigger dispatch_offers_notify_rider_reopened
  after update of status on dispatch_offers
  for each row
  when (old.status = 'expired' and new.status = 'offered')
  execute function notify_rider_of_new_offer();

-- ---------------------------------------------------------------------------
-- dispatch_order_to_nearby_riders(): ready_for_pickup trigger
-- ---------------------------------------------------------------------------

create or replace function dispatch_order_to_nearby_riders()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- 0064: a rider already claimed this order via an early accept. Cascade to
  -- rider_assigned; unchanged.
  if new.rider_id is not null then
    update orders
    set status = 'rider_assigned', assigned_at = now()
    where id = new.id;

    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (
      new.id, 'ready_for_pickup', 'rider_assigned', 'system', null,
      jsonb_build_object('reason', 'rider_pre_committed_via_early_accept')
    );

    return new;
  end if;

  -- The rider clock starts now, when the food is ready and a rider is truly
  -- needed - not at an earlier early-dispatch offer, which would eat into the
  -- 30 minute give-up window while the kitchen was still cooking. A new cycle
  -- starts too, so riders asked during early dispatch are eligible again.
  update orders
  set first_dispatched_at = now(),
      dispatch_cycle_started_at = now()
  where id = new.id;

  begin
    perform _dispatch_offer_batch(new.id, now());
  exception when others then
    -- Never abort the vendor's ready_for_pickup transition; the sweep retries.
    raise warning 'dispatch_order_to_nearby_riders: failed to create dispatch offers for order % - %', new.id, sqlerrm;
  end;

  return new;
end;
$function$;

comment on function dispatch_order_to_nearby_riders() is
  'AFTER UPDATE OF status trigger on orders: on ready_for_pickup either cascades to rider_assigned for a rider who early-accepted (0064), or restarts the rider clock and offers the order via _dispatch_offer_batch() (0076). SECURITY DEFINER because riders/dispatch_offers/orders writes must bypass RLS. A dispatch failure is a warning, never a failed transition.';

-- ---------------------------------------------------------------------------
-- dispatch_orders_nearing_prep_completion(): early dispatch sweep
-- ---------------------------------------------------------------------------

create or replace function dispatch_orders_nearing_prep_completion()
returns table (
  offers_created integer
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_caller_role   text := coalesce(auth.role(), current_setting('role', true));
  v_created_count integer := 0;
  v_candidate     record;
  v_order         orders;
  v_cycle         timestamptz;
  v_offered       integer;
  -- Minutes before the vendor's own estimated prep completion to start
  -- offering. Still the unmeasured placeholder from 0064.
  c_lead_minutes constant integer := 8;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'dispatch_orders_nearing_prep_completion: requires the service-role key';
  end if;

  for v_candidate in
    select o.id as order_id
    from orders o
    join vendors v on v.id = o.vendor_id
    where o.status in ('accepted', 'preparing')
      and o.rider_id is null
      and o.accepted_at is not null
      and now() >= o.accepted_at + make_interval(mins => greatest(v.avg_prep_mins - c_lead_minutes, 0))
      and not exists (
        select 1 from dispatch_offers d where d.order_id = o.id and d.status = 'offered'
      )
  loop
    select * into v_order from orders where id = v_candidate.order_id for update skip locked;
    if not found then
      continue;
    end if;

    if v_order.status not in ('accepted', 'preparing') or v_order.rider_id is not null then
      continue;
    end if;

    -- One cycle spans the whole early phase, so successive minute-ticks offer
    -- the NEXT-nearest riders instead of re-asking the same ones. Left alone
    -- when already set: ready_for_pickup starts its own fresh cycle.
    update orders
    set dispatch_cycle_started_at = coalesce(dispatch_cycle_started_at, now())
    where id = v_order.id
    returning dispatch_cycle_started_at into v_cycle;

    begin
      v_offered := _dispatch_offer_batch(v_order.id, v_cycle);
      v_created_count := v_created_count + v_offered;
    exception when others then
      raise warning 'dispatch_orders_nearing_prep_completion: failed to create dispatch offers for order % - %', v_order.id, sqlerrm;
    end;
  end loop;

  return query select v_created_count;
end;
$function$;

comment on function dispatch_orders_nearing_prep_completion() is
  'Early-dispatch sweep (0064): offers an order to the nearest eligible riders once the vendor''s estimated prep time is within c_lead_minutes of done, via _dispatch_offer_batch() (0076). Does not touch first_dispatched_at - the 30 minute give-up clock starts at ready_for_pickup. service_role only.';

-- ---------------------------------------------------------------------------
-- sweep_dispatch_offers(): re-dispatch and 30 minute give-up
-- ---------------------------------------------------------------------------

create or replace function sweep_dispatch_offers()
returns table (
  offers_expired   integer,
  offers_created   integer,
  orders_cancelled integer
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_caller_role     text := coalesce(auth.role(), current_setting('role', true));
  v_expired_count   integer := 0;
  v_created_count   integer := 0;
  v_cancelled_count integer := 0;
  v_offered         integer;
  v_candidate       record;
  v_order           orders;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'sweep_dispatch_offers: requires the service-role key';
  end if;

  with expired as (
    update dispatch_offers
    set status = 'expired', responded_at = now()
    where status = 'offered' and expires_at <= now()
    returning 1
  )
  select count(*)::integer into v_expired_count from expired;

  for v_candidate in
    select o.id as order_id
    from orders o
    where o.status = 'ready_for_pickup'
      and o.rider_id is null
      and not exists (
        select 1 from dispatch_offers d where d.order_id = o.id and d.status = 'offered'
      )
  loop
    select * into v_order from orders where id = v_candidate.order_id for update skip locked;
    if not found then
      continue;
    end if;

    if v_order.status <> 'ready_for_pickup' or v_order.rider_id is not null then
      continue;
    end if;

    -- An order that reached ready_for_pickup before 0067 was never stamped;
    -- give it a real anchor so the give-up below can eventually fire.
    if v_order.first_dispatched_at is null then
      update orders set first_dispatched_at = now() where id = v_order.id;
      v_order.first_dispatched_at := now();
    end if;

    -- Attempt 1 offers whoever is still untried this cycle. If that finds
    -- nobody and the cycle really was used up, attempt 2 opens a fresh cycle
    -- and asks the same riders again, closest first.
    for v_attempt in 1..2 loop
      begin
        v_offered := _dispatch_offer_batch(
          v_order.id,
          coalesce(v_order.dispatch_cycle_started_at, v_order.first_dispatched_at)
        );
      exception when others then
        -- A failure here must not exempt the order from the give-up below,
        -- or a persistently failing order would be stuck forever.
        raise warning 'sweep_dispatch_offers: failed to create dispatch offers for order % - %', v_order.id, sqlerrm;
        v_offered := 0;
      end;

      v_created_count := v_created_count + v_offered;
      exit when v_offered > 0;

      -- Someone still holds a live offer: nothing more to do this tick.
      exit when exists (
        select 1 from dispatch_offers where order_id = v_order.id and status = 'offered'
      );

      -- Nobody left to ask. Give up once the order has waited 30 minutes.
      -- This covers an order nobody can be offered at all (no vendor
      -- location, no eligible rider online), not only a used-up cycle.
      if now() >= v_order.first_dispatched_at + interval '30 minutes' then
        begin
          perform transition_order(
            v_order.id, 'cancelled_by_platform', 'system', null,
            jsonb_build_object('reason', 'dispatch_exhausted_after_30_minutes')
          );
          v_cancelled_count := v_cancelled_count + 1;
        exception when others then
          raise warning 'sweep_dispatch_offers: failed to auto-cancel order % after 30 minutes with no rider - %', v_order.id, sqlerrm;
        end;
        exit;
      end if;

      -- Only restart the cycle if riders were actually asked in it. With none
      -- online, a restart would rewrite the order row (and wake every realtime
      -- subscriber on it) every 15 seconds for no reason.
      exit when v_attempt = 2 or not exists (
        select 1 from dispatch_offers
        where order_id = v_order.id
          and offered_at >= coalesce(v_order.dispatch_cycle_started_at, v_order.first_dispatched_at)
      );

      update orders set dispatch_cycle_started_at = now() where id = v_order.id;
      v_order.dispatch_cycle_started_at := now();
    end loop;
  end loop;

  return query select v_expired_count, v_created_count, v_cancelled_count;
end;
$function$;

comment on function sweep_dispatch_offers() is
  'Re-dispatch sweep, run every 15s by pg_cron (0055): expires offers past their TTL, then for each ready_for_pickup order with no rider and no live offer, re-offers via _dispatch_offer_batch() - re-opening expired offers, never resurrecting declines - and restarts the cycle when everyone eligible has been asked. Cancels the order via transition_order(cancelled_by_platform) once it has waited 30 minutes with nobody left to ask, which also refunds it. service_role only.';

-- ---------------------------------------------------------------------------
-- accept_dispatch_offer() / get_rider_offer_details(), from the live bodies
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.accept_dispatch_offer(p_order_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order                   orders;
  v_offer                   dispatch_offers;
  v_vendor_location         geography(point, 4326);
  v_rider_location          geography(point, 4326);
  v_area                    service_areas;
  v_pickup_distance_m       double precision;
  v_rider_fee_kobo          bigint;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'accept_dispatch_offer: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- Relaxed from "= 'ready_for_pickup'" (0044) to also allow an early
  -- accept while the vendor is still preparing - see this migration's own
  -- header for the full reasoning. rider_id-null is still required either
  -- way: exactly one rider may ever claim an order.
  if v_order.status not in ('accepted', 'preparing', 'ready_for_pickup') or v_order.rider_id is not null then
    raise exception 'accept_dispatch_offer: order already assigned or not ready for pickup';
  end if;

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

  if v_offer.expires_at <= now() then
    update dispatch_offers
    set status = 'expired', responded_at = now()
    where order_id = p_order_id and rider_id = auth.uid() and status = 'offered';

    raise exception 'accept_dispatch_offer: offer has expired';
  end if;

  -- rider_fee_kobo is computed identically on both paths - the rider's own
  -- distance to the vendor right now, plus the order's existing
  -- vendor->customer distance_m. Unchanged formula from 0044.
  -- The fee is frozen from this position, so it has to be a live one: a
  -- rider who is offline, or whose last ping is minutes old, is not where the
  -- stored coordinates say.
  select current_location into v_rider_location
  from riders
  where user_id = auth.uid()
    and is_online
    and last_ping_at >= now() - interval '5 minutes';
  if v_rider_location is null then
    raise exception 'accept_dispatch_offer: rider must be online with a location update from the last 5 minutes to accept';
  end if;

  select location into v_vendor_location from vendors where id = v_order.vendor_id;
  if v_vendor_location is null then
    raise exception 'accept_dispatch_offer: vendor has no location set, cannot compute rider fee';
  end if;

  if v_order.service_area_id is null then
    raise exception 'accept_dispatch_offer: order % has no service_area_id, cannot compute rider fee', p_order_id;
  end if;

  select * into v_area from service_areas where id = v_order.service_area_id;
  if not found then
    raise exception 'accept_dispatch_offer: service area % does not exist', v_order.service_area_id;
  end if;

  v_pickup_distance_m := st_distance(v_rider_location, v_vendor_location);

  v_rider_fee_kobo := v_area.rider_base_fee_kobo
    + v_area.rider_per_km_fee_kobo * ceil((v_pickup_distance_m + coalesce(v_order.distance_m, 0)) / 1000.0)::bigint;

  -- 0076: the payout has to be fundable. release refuses a negative platform
  -- share, so a rider far from the vendor could accept, complete the whole
  -- delivery, and only then find the order could not pay anyone out. Refuse
  -- here instead, before anything is promised.
  if v_rider_fee_kobo > _max_rider_fee_kobo(p_order_id) then
    raise exception 'accept_dispatch_offer: order % is too far from this rider - the payout would exceed what the order can fund', p_order_id
      using errcode = 'check_violation';
  end if;

  if v_order.status = 'ready_for_pickup' then
    -- Unchanged from 0044: the normal, today's-behavior path. status moves
    -- straight to rider_assigned here because the order is already ready -
    -- there is no later ready_for_pickup transition left to cascade from.
    if not exists (
      select 1 from order_status_transitions
      where from_status = 'ready_for_pickup' and to_status = 'rider_assigned'
    ) then
      raise exception 'accept_dispatch_offer: ready_for_pickup -> rider_assigned is not a legal transition';
    end if;

    update orders
    set rider_id = auth.uid(),
        status = 'rider_assigned',
        assigned_at = now(),
        rider_fee_kobo = v_rider_fee_kobo,
        rider_pickup_distance_m = round(v_pickup_distance_m)
    where id = p_order_id
    returning * into v_order;

    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (p_order_id, 'ready_for_pickup', 'rider_assigned', 'rider', auth.uid(), '{}'::jsonb);
  else
    -- NEW: an early accept, while the order is still 'accepted' or
    -- 'preparing'. Claims rider_id and freezes rider_fee_kobo right now
    -- (the rider's trip starts now, so their pay is set from where they
    -- actually are now) but deliberately leaves orders.status and
    -- assigned_at untouched - the vendor's own transition_order() calls are
    -- still the only thing that advances status through accepted ->
    -- preparing -> ready_for_pickup. dispatch_order_to_nearby_riders()
    -- (0023, this migration) detects rider_id already being set the moment
    -- ready_for_pickup is reached and cascades to rider_assigned itself -
    -- see that function's own comment. Until then, this rider shows up on
    -- their own active-order screen (useActiveOrder, kiakia-rider) exactly
    -- as any assigned rider would, since that query is keyed on
    -- orders.rider_id, not status.
    update orders
    set rider_id = auth.uid(),
        rider_fee_kobo = v_rider_fee_kobo,
        rider_pickup_distance_m = round(v_pickup_distance_m)
    where id = p_order_id
    returning * into v_order;

    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (
      p_order_id, v_order.status, v_order.status, 'rider', auth.uid(),
      jsonb_build_object('early_accept', true, 'order_status_at_accept', v_order.status)
    );
  end if;

  update dispatch_offers
  set status = 'accepted', responded_at = now()
  where order_id = p_order_id and rider_id = auth.uid();

  -- Unchanged from 0044: once this transaction commits, orders.rider_id is
  -- no longer null, so any concurrent/later accept attempt - on either path
  -- - fails the rider_id-null check at the top regardless of that rider's
  -- own offer status.
  update dispatch_offers
  set status = 'expired', responded_at = now()
  where order_id = p_order_id and rider_id <> auth.uid() and status = 'offered';

  return v_order;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_rider_offer_details(p_order_id uuid)
 RETURNS TABLE(order_code text, status text, vendor_name text, vendor_address_line text, vendor_landmark text, pickup_lat double precision, pickup_lng double precision, dropoff_lat double precision, dropoff_lng double precision, delivery_address jsonb, delivery_note text, item_count integer, total_kobo bigint, delivery_fee_kobo bigint, distance_m integer, pickup_distance_m integer, rider_fee_estimate_kobo bigint, customer_name text, customer_phone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order              orders;
  v_vendor             vendors;
  v_rider_location     geography(point, 4326);
  v_area               service_areas;
  v_pickup_distance_m  double precision;
  v_rider_fee_estimate bigint;
  v_customer_profile   profiles;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'get_rider_offer_details: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if auth.uid() is null then
    raise exception 'get_rider_offer_details: no authenticated caller';
  end if;

  -- Authorization unchanged from 0058 - every dispatch_offers.*
  -- reference already qualified there, reproduced byte for byte.
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
  -- Customer contact is for the rider who actually holds the delivery. A rider
  -- with only a live offer (up to ten of them, at any distance) gets NULLs:
  -- their number is not theirs to have until they accept.
  if v_order.rider_id = auth.uid() then
    select * into v_customer_profile from profiles where id = v_order.customer_id;
  end if;

  -- Best-effort live estimate, unchanged from 0044/0057/0058.
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
    v_customer_profile.full_name,
    v_customer_profile.phone;
end;
$function$
;
