-- KiaKia - admin dispatch override: take an order off its rider and re-offer it,
-- or put a specific rider on it.
--
-- Until now an order that a rider stalled on, or that a rider accepted and then
-- went quiet on, could only be left to run or cancelled. Support needs a way to
-- say "this rider is out, find another" and, when they have a rider on the
-- phone, "give it to this one".
--
--   admin_reassign_order_rider(order, rider | null, reason, actor)
--     rider null  - unassign (if one is assigned) and offer the order afresh.
--     rider set   - FORCE that rider onto the order (swapping out any current one).
--   admin_list_assignable_riders(order, limit)
--     the riders the second mode would accept, nearest the vendor first, each
--     with the exact fee the assignment would freeze.
--
-- WHEN IT APPLIES. Only while nothing has been picked up: accepted, preparing,
-- ready_for_pickup, rider_assigned. From picked_up onward the goods are with the
-- rider and the order is a delivery in progress (0082), not a dispatch problem.
-- The order row is locked FIRST, the same lock accept_dispatch_offer() takes, so
-- an admin override and a rider accepting serialize: whichever commits second
-- sees the other's result (a late accept fails "already assigned"; a late
-- unassign removes the rider who just accepted).
--
-- UNASSIGN. The previous rider's dispatch_offers row becomes 'revoked' (new
-- status): _dispatch_offer_batch() excludes revoked riders for good, as it does
-- declined ones, so the rider an admin removed is never re-offered the same
-- order by the sweep. rider_id, rider_fee_kobo (back to its default 0),
-- rider_pickup_distance_m and assigned_at are cleared, the order's
-- order_rider_locations row is deleted (the customer's map must not keep showing
-- the removed rider) and the removed rider gets a rider_notifications row.
-- release_suspended_rider_sessions() (0082) fires on the rider_id change but only
-- acts for an order that was in progress, which is refused here, so it stays
-- inert.
--
-- RE-OFFER FROM rider_assigned moves the order straight back to ready_for_pickup
-- in the same UPDATE that clears rider_id. order_status_transitions has no
-- rider_assigned -> ready_for_pickup edge, so this is a direct write with an
-- explicit order_events row (actor_type 'admin'), the precedent 0064 set for its
-- cascade. That UPDATE is a transition INTO ready_for_pickup, so
-- orders_dispatch_to_riders fires: rider_id is null, so it stamps
-- first_dispatched_at and dispatch_cycle_started_at to now() and offers the
-- order through _dispatch_offer_batch(). The 30 minute give-up window
-- (sweep_dispatch_offers, 0067) therefore RESTARTS from the reassignment, which
-- is intended: the order did not wait 30 minutes for a rider the admin just
-- removed. ready_at is left alone. Re-offering an accepted/preparing order keeps
-- its status (the early-accept model, 0064), starts a fresh dispatch cycle and
-- offers right away; re-offering a ready_for_pickup order that has no rider and
-- no live offer nudges _dispatch_offer_batch() within its current cycle without
-- touching first_dispatched_at. The customer's status notification
-- (0038) will say the order is "ready and waiting for a rider" again after a
-- rider_assigned -> ready_for_pickup move, which is accurate.
--
-- ASSIGN is a forced assignment (an explicit product decision), but not an
-- unchecked one: the target must be KYC-approved with an active profile, online,
-- with a location update under 5 minutes old, and hold no other active order
-- (accepted .. arrived). Their fee and pickup distance are quoted by
-- _quote_rider_fee(), the one place the accept formula and the fundability check
-- (_max_rider_fee_kobo) now live; accept_dispatch_offer() is redefined below to use
-- it too, so the two cannot drift. The rider's offer row is upserted to
-- 'accepted' and every other live offer is expired, exactly as accept does.
-- ready_for_pickup becomes rider_assigned (the dispatch trigger only fires INTO
-- ready_for_pickup so it does not run); rider_assigned stays and is re-stamped;
-- accepted/preparing keep their status with the rider claimed, the early-accept
-- shape. Unlike a rider's own accept, the new rider is told through
-- rider_notifications, since they did not tap anything.
--
-- PUSH. notify_rider_of_new_offer() (0065) was AFTER INSERT with no condition, so
-- inserting an 'accepted' row for a forced assignment would have pushed the rider
-- "new offer" for something they cannot accept. It now only fires for rows
-- inserted as 'offered', which is every insert the dispatch paths make. The
-- re-opened-offer trigger (0076) is already conditional.
--
-- Nothing here touches money: no ledger entries, no wallet, no escrow.
-- accept_dispatch_offer() is reproduced from its LIVE definition (0082) with only
-- the fee computation moved into the helper.

-- ---------------------------------------------------------------------------
-- dispatch_offers.status: 'revoked'
-- ---------------------------------------------------------------------------

alter table dispatch_offers drop constraint dispatch_offers_status_check;
alter table dispatch_offers
  add constraint dispatch_offers_status_check
  check (status in ('offered', 'accepted', 'expired', 'declined', 'revoked'));

comment on column dispatch_offers.status is
  'offered: live until expires_at. accepted: the rider holds the order. expired: lapsed (may be re-opened). declined: the rider refused (never re-offered). revoked: an admin removed the rider from the order (never re-offered, 0083).';

-- ---------------------------------------------------------------------------
-- No "new offer" push for a row that is not an offer
-- ---------------------------------------------------------------------------

drop trigger dispatch_offers_notify_rider on dispatch_offers;

create trigger dispatch_offers_notify_rider
  after insert on dispatch_offers
  for each row
  when (new.status = 'offered')
  execute function notify_rider_of_new_offer();

-- ---------------------------------------------------------------------------
-- _quote_rider_fee(): the rider's fee for an order, in one place
-- ---------------------------------------------------------------------------

create function _quote_rider_fee(p_order_id uuid, p_rider_id uuid)
returns table (fee_kobo bigint, pickup_distance_m integer, fundable boolean)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_order           orders;
  v_rider_location  geography(point, 4326);
  v_vendor_location geography(point, 4326);
  v_area            service_areas;
  v_pickup_m        double precision;
  v_fee             bigint;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception '_quote_rider_fee: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  select current_location into v_rider_location from riders where user_id = p_rider_id;
  if v_rider_location is null then
    raise exception '_quote_rider_fee: rider has no current_location, cannot compute rider fee'
      using errcode = 'check_violation';
  end if;

  select location into v_vendor_location from vendors where id = v_order.vendor_id;
  if v_vendor_location is null then
    raise exception '_quote_rider_fee: vendor has no location set, cannot compute rider fee'
      using errcode = 'check_violation';
  end if;

  if v_order.service_area_id is null then
    raise exception '_quote_rider_fee: order % has no service_area_id, cannot compute rider fee', p_order_id
      using errcode = 'check_violation';
  end if;

  select * into v_area from service_areas where id = v_order.service_area_id;
  if not found then
    raise exception '_quote_rider_fee: service area % does not exist', v_order.service_area_id
      using errcode = 'check_violation';
  end if;

  -- The 0044 formula: the rider's own distance to the vendor right now, plus the
  -- order's existing vendor -> customer distance_m.
  v_pickup_m := st_distance(v_rider_location, v_vendor_location);
  v_fee := v_area.rider_base_fee_kobo
    + v_area.rider_per_km_fee_kobo * ceil((v_pickup_m + coalesce(v_order.distance_m, 0)) / 1000.0)::bigint;

  -- 0076: the payout has to be fundable, or release would refuse a negative
  -- platform share after the whole delivery.
  return query select v_fee, round(v_pickup_m)::integer, v_fee <= _max_rider_fee_kobo(p_order_id);
end;
$function$;

comment on function _quote_rider_fee(uuid, uuid) is
  'The rider fee (kobo) and rounded pickup distance (m) for a rider on an order, computed from the rider''s stored location with the 0044 formula, and whether _max_rider_fee_kobo() can fund it. Single source for accept_dispatch_offer() and the admin override. Does not check the rider is online or recent - callers do. Raises check_violation when the rider, vendor or service area has no location/rates to compute from. Internal.';

revoke all on function _quote_rider_fee(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- _rider_assign_blocker(): why a rider cannot be forced onto an order
-- ---------------------------------------------------------------------------

create function _rider_assign_blocker(p_rider_id uuid, p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r.user_id is null then 'is not a registered rider'
    when r.kyc_status <> 'approved' then 'is not KYC-approved'
    when p.status is distinct from 'active' then 'does not have an active account'
    when not r.is_online then 'is offline'
    when r.current_location is null or r.last_ping_at is null or r.last_ping_at < now() - interval '5 minutes'
      then 'has not shared a location in the last 5 minutes'
    when exists (
      select 1 from orders o
      where o.rider_id = r.user_id
        and o.id <> p_order_id
        and o.status in ('accepted', 'preparing', 'rider_assigned', 'picked_up', 'in_transit', 'arrived')
    ) then 'already has an active order'
  end
  from (select 1) one
  left join riders r on r.user_id = p_rider_id
  left join profiles p on p.id = p_rider_id
$$;

comment on function _rider_assign_blocker(uuid, uuid) is
  'NULL when the rider may be forced onto the order, else the reason (completing "the rider ...") for the admin: not KYC-approved, inactive account, offline, no location in the last 5 minutes, or already holding another active order (accepted .. arrived). Used by both admin_reassign_order_rider() and admin_list_assignable_riders() so they cannot disagree. Internal.';

revoke all on function _rider_assign_blocker(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- _dispatch_offer_batch(): reproduced from 0076, 'revoked' excluded for good
-- ---------------------------------------------------------------------------

create or replace function _dispatch_offer_batch(
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
  -- available (online, approved, active account, pinged in the last 5 minutes,
  -- not already on an order - the same rules accept enforces, 0083) and whose
  -- fee the order can actually fund. A rider is skipped if they declined, were
  -- revoked by an admin (0083), already hold a live or accepted offer, or were
  -- already asked in the current cycle; one whose earlier offer merely EXPIRED
  -- (and was not asked this cycle) is re-opened rather than skipped forever.
  insert into dispatch_offers (order_id, rider_id)
  select p_order_id, r.user_id
  from riders r
  where r.is_online
    and r.kyc_status = 'approved'
    and r.current_location is not null
    and r.last_ping_at >= now() - interval '5 minutes'
    and exists (select 1 from profiles p where p.id = r.user_id and p.status = 'active')
    and not exists (
      select 1 from orders o
      where o.rider_id = r.user_id
        and o.status in ('accepted', 'preparing', 'rider_assigned', 'picked_up', 'in_transit', 'arrived')
    )
    and v_area.rider_base_fee_kobo
        + v_area.rider_per_km_fee_kobo
          * ceil((st_distance(r.current_location, v_vendor_location) + coalesce(v_order.distance_m, 0)) / 1000.0)::bigint
        <= v_max_rider_fee
    and not exists (
      select 1 from dispatch_offers d
      where d.order_id = p_order_id
        and d.rider_id = r.user_id
        and (d.status in ('declined', 'revoked', 'accepted', 'offered') or d.offered_at >= p_cycle_started_at)
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

-- ---------------------------------------------------------------------------
-- accept_dispatch_offer(): reproduced from 0082, fee via _quote_rider_fee()
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
  v_rider_location          geography(point, 4326);
  v_pickup_distance_m       integer;
  v_rider_fee_kobo          bigint;
  v_fundable                boolean;
begin
  perform _assert_active_caller();

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'accept_dispatch_offer: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  -- Relaxed from "= 'ready_for_pickup'" (0044) to also allow an early
  -- accept while the vendor is still preparing - see 0064's own header for the
  -- full reasoning. rider_id-null is still required either way: exactly one
  -- rider may ever claim an order.
  if v_order.status not in ('accepted', 'preparing', 'ready_for_pickup') or v_order.rider_id is not null then
    raise exception 'accept_dispatch_offer: order already assigned or not ready for pickup';
  end if;

  if not exists (
    select 1 from riders where user_id = auth.uid() and kyc_status = 'approved'
  ) then
    raise exception 'accept_dispatch_offer: rider is not kyc-approved';
  end if;

  -- 0083: one active order per rider. Locking the rider row (after the order,
  -- the same order admin_reassign_order_rider() takes them in) serialises this
  -- against an admin forcing the same rider onto another order.
  perform 1 from riders where user_id = auth.uid() for update;
  if exists (
    select 1 from orders
    where rider_id = auth.uid()
      and id <> p_order_id
      and status in ('accepted', 'preparing', 'rider_assigned', 'picked_up', 'in_transit', 'arrived')
  ) then
    raise exception 'accept_dispatch_offer: rider already has an active order'
      using errcode = 'check_violation';
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

  -- The fee is frozen from the rider's position, so it has to be a live one: a
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

  -- rider_fee_kobo is computed identically on both paths, by the same helper
  -- the admin override uses (0083).
  select q.fee_kobo, q.pickup_distance_m, q.fundable
  into v_rider_fee_kobo, v_pickup_distance_m, v_fundable
  from _quote_rider_fee(p_order_id, auth.uid()) q;

  -- 0076: the payout has to be fundable. release refuses a negative platform
  -- share, so a rider far from the vendor could accept, complete the whole
  -- delivery, and only then find the order could not pay anyone out. Refuse
  -- here instead, before anything is promised.
  if not v_fundable then
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
        rider_pickup_distance_m = v_pickup_distance_m
    where id = p_order_id
    returning * into v_order;

    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (p_order_id, 'ready_for_pickup', 'rider_assigned', 'rider', auth.uid(), '{}'::jsonb);
  else
    -- An early accept, while the order is still 'accepted' or 'preparing'.
    -- Claims rider_id and freezes rider_fee_kobo right now (the rider's trip
    -- starts now, so their pay is set from where they actually are now) but
    -- deliberately leaves orders.status and assigned_at untouched - the
    -- vendor's own transition_order() calls are still the only thing that
    -- advances status through accepted -> preparing -> ready_for_pickup.
    -- dispatch_order_to_nearby_riders() detects rider_id already being set the
    -- moment ready_for_pickup is reached and cascades to rider_assigned itself.
    -- Until then, this rider shows up on their own active-order screen
    -- (useActiveOrder, kiakia-rider) exactly as any assigned rider would, since
    -- that query is keyed on orders.rider_id, not status.
    update orders
    set rider_id = auth.uid(),
        rider_fee_kobo = v_rider_fee_kobo,
        rider_pickup_distance_m = v_pickup_distance_m
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

  -- Once this transaction commits, orders.rider_id is no longer null, so any
  -- concurrent/later accept attempt - on either path - fails the rider_id-null
  -- check at the top regardless of that rider's own offer status.
  update dispatch_offers
  set status = 'expired', responded_at = now()
  where order_id = p_order_id and rider_id <> auth.uid() and status = 'offered';

  return v_order;
end;
$function$;

-- ---------------------------------------------------------------------------
-- admin_reassign_order_rider()
-- ---------------------------------------------------------------------------

create function admin_reassign_order_rider(
  p_order_id  uuid,
  p_rider_id  uuid,
  p_reason    text,
  p_actor_id  uuid
)
returns orders
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_reason        text;
  v_order         orders;
  v_from_status   order_status;
  v_fee_before    bigint;
  v_previous      uuid;
  v_blocker       text;
  v_fee           bigint;
  v_pickup_m      integer;
  v_fundable      boolean;
  v_live_offers   integer;
  v_mode          text := case when p_rider_id is null then 'reoffer' else 'assign' end;
begin
  perform _assert_admin_actor('admin_reassign_order_rider', p_actor_id);
  v_reason := _admin_reason('admin_reassign_order_rider', p_reason, true);

  -- The order lock comes first: same as accept_dispatch_offer(), so an admin
  -- override and a rider accepting serialize on this row.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'admin_reassign_order_rider: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if v_order.status not in ('accepted', 'preparing', 'ready_for_pickup', 'rider_assigned') then
    raise exception 'admin_reassign_order_rider: order % is % - a rider can only be changed before pickup', v_order.code, v_order.status
      using errcode = 'check_violation';
  end if;

  v_from_status := v_order.status;
  v_fee_before := v_order.rider_fee_kobo;
  v_previous := v_order.rider_id;

  if p_rider_id is not null then
    -- Already theirs: nothing to do and nothing to audit.
    if v_previous = p_rider_id then
      return v_order;
    end if;

    perform 1 from riders where user_id = p_rider_id for update;
    if not found then
      raise exception 'admin_reassign_order_rider: rider % does not exist', p_rider_id
        using errcode = 'no_data_found';
    end if;

    v_blocker := _rider_assign_blocker(p_rider_id, p_order_id);
    if v_blocker is not null then
      raise exception 'admin_reassign_order_rider: this rider %', v_blocker
        using errcode = 'check_violation';
    end if;

    select q.fee_kobo, q.pickup_distance_m, q.fundable
    into v_fee, v_pickup_m, v_fundable
    from _quote_rider_fee(p_order_id, p_rider_id) q;
    if not v_fundable then
      raise exception 'admin_reassign_order_rider: this order is too far from that rider - the payout would exceed what the order can fund'
        using errcode = 'check_violation';
    end if;
  elsif v_previous is null and v_from_status <> 'rider_assigned' and exists (
    select 1 from dispatch_offers
    where order_id = p_order_id and status = 'offered' and expires_at > now()
  ) then
    -- Already on offer: nothing to do and nothing to audit.
    return v_order;
  end if;

  -- Take the current rider off the order.
  if v_previous is not null then
    update dispatch_offers
    set status = 'revoked', responded_at = now()
    where order_id = p_order_id and rider_id = v_previous and status = 'accepted';

    delete from order_rider_locations where order_id = p_order_id;

    insert into rider_notifications (rider_id, order_id, title, body)
    values (
      v_previous, p_order_id, 'Delivery reassigned',
      format('Order %s was taken off you by KiaKia support and no longer needs delivery from you.', v_order.code)
    );
  end if;

  if p_rider_id is not null then
    update orders
    set rider_id = p_rider_id,
        rider_fee_kobo = v_fee,
        rider_pickup_distance_m = v_pickup_m,
        status = case when status = 'ready_for_pickup' then 'rider_assigned'::order_status else status end,
        assigned_at = case when status in ('ready_for_pickup', 'rider_assigned') then now() else assigned_at end
    where id = p_order_id
    returning * into v_order;

    insert into dispatch_offers (order_id, rider_id, status, responded_at)
    values (p_order_id, p_rider_id, 'accepted', now())
    on conflict (order_id, rider_id) do update
      set status = 'accepted', responded_at = now();

    update dispatch_offers
    set status = 'expired', responded_at = now()
    where order_id = p_order_id and rider_id <> p_rider_id and status = 'offered';

    insert into rider_notifications (rider_id, order_id, title, body)
    values (
      p_rider_id, p_order_id, 'Delivery assigned to you',
      format('KiaKia support assigned order %s to you. Open it to see the pickup details.', v_order.code)
    );
  else
    if v_previous is not null or v_from_status = 'rider_assigned' then
      -- From rider_assigned the status moves back to ready_for_pickup in this
      -- same UPDATE; that fires the dispatch trigger, which restarts the rider
      -- clock and offers the order.
      update orders
      set rider_id = null,
          rider_fee_kobo = 0,
          rider_pickup_distance_m = null,
          assigned_at = null,
          status = case when status = 'rider_assigned' then 'ready_for_pickup'::order_status else status end
      where id = p_order_id
      returning * into v_order;
    end if;

    if v_order.status in ('accepted', 'preparing') then
      update orders set dispatch_cycle_started_at = now() where id = p_order_id;
      perform _dispatch_offer_batch(p_order_id, now());
    elsif v_from_status = 'ready_for_pickup' then
      perform _dispatch_offer_batch(p_order_id, coalesce(v_order.dispatch_cycle_started_at, now()));
    end if;
  end if;

  -- The triggers above may have rewritten the row (clock stamps).
  select * into v_order from orders where id = p_order_id;

  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (
    p_order_id, v_from_status, v_order.status, 'admin', p_actor_id,
    jsonb_build_object('reason', v_reason, 'previous_rider_id', v_previous, 'admin_reassign', true)
      || case when p_rider_id is not null then jsonb_build_object('new_rider_id', p_rider_id) else '{}'::jsonb end
  );

  select count(*)::integer into v_live_offers
  from dispatch_offers where order_id = p_order_id and status = 'offered';

  perform _write_admin_audit(
    p_actor_id, 'order.reassign_rider', 'order', p_order_id, v_reason,
    jsonb_build_object(
      'mode', v_mode,
      'previous_rider_id', v_previous,
      'new_rider_id', p_rider_id,
      'from_status', v_from_status,
      'to_status', v_order.status,
      'rider_fee_kobo_before', v_fee_before,
      'rider_fee_kobo_after', v_order.rider_fee_kobo,
      'live_offers', v_live_offers
    )
  );

  return v_order;
end;
$function$;

comment on function admin_reassign_order_rider(uuid, uuid, text, uuid) is
  'Admin dispatch override for an order that has not been picked up (accepted, preparing, ready_for_pickup, rider_assigned). p_rider_id null: unassign the current rider (their offer becomes revoked, so they are never re-offered; fee, location and notification handled) and offer the order afresh - from rider_assigned the status returns to ready_for_pickup and the 30 minute give-up window restarts. p_rider_id set: force that rider onto the order (KYC-approved, active, online, recent location, no other active order, fee fundable), expiring every other live offer. Locks the order first, like accept_dispatch_offer(). Reason required; one admin_audit_log row and one order_events row; no ledger writes. Idempotent: assigning the current rider, or re-offering an order already on offer, is a no-op with no audit row. service_role only.';

revoke execute on function admin_reassign_order_rider(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function admin_reassign_order_rider(uuid, uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- admin_list_assignable_riders(): the picker behind assign mode
-- ---------------------------------------------------------------------------

create function admin_list_assignable_riders(p_order_id uuid, p_limit integer default 20)
returns table (
  rider_id           uuid,
  full_name          text,
  phone              text,
  pickup_distance_m  integer,
  rider_fee_kobo     bigint,
  last_ping_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_order           orders;
  v_vendor_location geography(point, 4326);
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'admin_list_assignable_riders: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  select location into v_vendor_location from vendors where id = v_order.vendor_id;
  if v_vendor_location is null or v_order.service_area_id is null then
    return;
  end if;

  return query
  select r.user_id, pr.full_name, pr.phone, q.pickup_distance_m, q.fee_kobo, r.last_ping_at
  from riders r
  join profiles pr on pr.id = r.user_id
  cross join lateral _quote_rider_fee(p_order_id, r.user_id) q
  where r.is_online
    and r.kyc_status = 'approved'
    and r.current_location is not null
    and r.user_id is distinct from v_order.rider_id
    and _rider_assign_blocker(r.user_id, p_order_id) is null
    and q.fundable
  order by r.current_location <-> v_vendor_location
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$function$;

comment on function admin_list_assignable_riders(uuid, integer) is
  'The riders admin_reassign_order_rider() would accept for this order (approved, active, online, recent location, no other active order, fee fundable), nearest the vendor first, with the exact fee and pickup distance the assignment would freeze (via _quote_rider_fee). The order''s current rider is excluded. Empty when the vendor has no location or the order no service area. p_limit is clamped to 1..100. Read-only; service_role only.';

revoke execute on function admin_list_assignable_riders(uuid, integer) from public, anon, authenticated;
grant execute on function admin_list_assignable_riders(uuid, integer) to service_role;
