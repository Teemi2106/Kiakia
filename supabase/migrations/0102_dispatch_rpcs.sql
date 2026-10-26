-- 0102: rider / admin / vendor RPCs on the sequential dispatch engine
-- (docs/dispatch-design.md D2, D5, D10, D11, D12).
--
-- Every path that changes who holds an order now goes through ONE core,
-- _dispatch_respond(), or through the engine (_dispatch_advance). Lock order,
-- everywhere: orders -> riders -> order_dispatch -> dispatch_offers.
--
-- Sections
--   1. Rate limit (30 offer responses per rider per rolling minute, P0429)
--   2. Outcome helpers
--   3. _dispatch_respond: accept / decline in one place
--   4. Rider RPCs: legacy wrappers (same names, arguments, return types and
--      error substrings as the rider app maps them), get_dispatch_offer,
--      respond_to_dispatch_offer
--   5. Admin: reassign, redispatch, settings, status, order history
--   6. Vendor: expand, self delivery, dispatch view
--   7. Grants and comments
--
-- NOT changed on purpose: get_rider_offer_details. It authorises with EXISTS
-- over the caller's offers on the order (accepted, or live and unexpired), so it
-- never "picks" one row and is already correct with several offer rows per
-- (order, rider); its signature, columns and 0072 privacy rules are untouched.
-- The 0100 shim dispatch_offers_default_numbers stays: every production writer
-- now sets cycle_no / attempt_no explicitly, but the existing pgTAP fixtures
-- (and any hand-run SQL) still insert offers without them.

-- ===========================================================================
-- 1. Rate limit
-- ===========================================================================

-- A bounded log (one row per response call, rows older than 5 minutes are
-- deleted by the same rider's next call) gives an exact rolling window with an
-- index range count of at most 30 rows. No FK: a non-rider hammering the RPC is
-- limited too. 0103 should purge idle riders' leftovers with the other crons.
create table if not exists rider_offer_responses (
  rider_id uuid        not null,
  at       timestamptz not null default clock_timestamp()
);
create index if not exists rider_offer_responses_rider_at_idx on rider_offer_responses (rider_id, at);
alter table rider_offer_responses enable row level security;
revoke all on rider_offer_responses from public, anon, authenticated;

-- Only calls that RETURN are counted (a raise rolls the insert back): the new
-- respond_to_dispatch_offer never raises for races, the legacy wrappers raise for
-- lost races, so those losers are not counted. 30 per minute leaves room for a
-- few retries of the same idempotent call.
create or replace function _dispatch_rate_check(p_rider uuid)
returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_n integer;
begin
  -- Serialise this rider's calls so two concurrent ones cannot both see 29.
  perform pg_advisory_xact_lock(hashtextextended('dispatch_respond:' || coalesce(p_rider::text, ''), 0));
  delete from rider_offer_responses where rider_id = p_rider and at < clock_timestamp() - interval '5 minutes';
  select count(*)::integer into v_n from rider_offer_responses
  where rider_id = p_rider and at >= clock_timestamp() - interval '1 minute';
  if v_n >= 30 then
    raise exception 'rate_limited: too many offer responses, wait a moment and try again'
      using errcode = 'P0429';
  end if;
  insert into rider_offer_responses (rider_id) values (p_rider);
end;
$$;

-- ===========================================================================
-- 2. Outcome helpers
-- ===========================================================================

-- The one JSON shape every respond path returns.
create or replace function _dispatch_outcome(p_outcome text, p_offer dispatch_offers, p_reason text default null, p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'outcome', p_outcome,
    'reason', p_reason,
    'offer_id', p_offer.id,
    'order_id', p_offer.order_id,
    'status', p_offer.status,
    'close_reason', p_offer.close_reason,
    'offered_at', p_offer.offered_at,
    'expires_at', p_offer.expires_at,
    'seconds_left', case when p_offer.status = 'offered'
                         then greatest(0, ceil(extract(epoch from p_offer.expires_at - now())))::integer else 0 end,
    'server_time', now()) || coalesce(p_extra, '{}'::jsonb)
$$;

-- Not this rider's offer (or no such offer): identical for both, so an offer id
-- of another rider reveals nothing.
create or replace function _dispatch_not_found(p_offer_id uuid)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('outcome', 'not_found', 'reason', 'no_such_offer', 'offer_id', p_offer_id, 'order_id', null,
    'status', null, 'close_reason', null, 'offered_at', null, 'expires_at', null, 'seconds_left', 0, 'server_time', now())
$$;

-- The caller's offer on an order: the live one, else the accepted one, else the latest.
create or replace function _dispatch_pick_offer(p_order_id uuid, p_rider uuid)
returns uuid
language sql stable security definer set search_path to 'public' as $$
  select d.id from dispatch_offers d
  where d.order_id = p_order_id and d.rider_id = p_rider
  order by case d.status when 'offered' then 0 when 'accepted' then 1 else 2 end, d.attempt_no desc
  limit 1
$$;

-- Initial pickup ETA once a rider holds the order (0104 keeps it fresh).
create or replace function _dispatch_stamp_assigned_eta(p_order_id uuid)
returns void
language sql security definer set search_path to 'public' as $$
  update order_dispatch od
  set assigned_eta_at = now() + make_interval(secs => e.eta),
      current_eta_at = now() + make_interval(secs => e.eta),
      eta_updated_at = now()
  from (select _estimate_travel_seconds(r.current_location, v.location, o.service_area_id) as eta
        from orders o
        join vendors v on v.id = o.vendor_id
        join riders r on r.user_id = o.rider_id
        where o.id = p_order_id) e
  where od.order_id = p_order_id and e.eta is not null
$$;

-- What a rider may see of an order they are offered or hold: exactly the
-- get_rider_offer_details columns, with the 0072 rule that the customer's name
-- and phone exist only for the rider who holds the order.
create or replace function _rider_offer_detail_json(p_order orders, p_rider uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_vendor   vendors;
  v_area     service_areas;
  v_loc      geography(point, 4326);
  v_pickup_m double precision;
  v_estimate bigint;
  v_customer profiles;
begin
  select * into v_vendor from vendors where id = p_order.vendor_id;
  if p_order.rider_id = p_rider then
    select * into v_customer from profiles where id = p_order.customer_id;
  end if;
  select current_location into v_loc from riders where user_id = p_rider;
  if v_loc is not null and v_vendor.location is not null and p_order.service_area_id is not null then
    select * into v_area from service_areas where id = p_order.service_area_id;
    if found then
      v_pickup_m := st_distance(v_loc, v_vendor.location);
      v_estimate := v_area.rider_base_fee_kobo
        + v_area.rider_per_km_fee_kobo * ceil((v_pickup_m + coalesce(p_order.distance_m, 0)) / 1000.0)::bigint;
    end if;
  end if;
  return jsonb_build_object(
    'order_code', p_order.code,
    'status', p_order.status::text,
    'vendor_name', v_vendor.name,
    'vendor_address_line', v_vendor.address_line,
    'vendor_landmark', v_vendor.landmark,
    'pickup_lat', st_y(v_vendor.location::geometry),
    'pickup_lng', st_x(v_vendor.location::geometry),
    'dropoff_lat', st_y(p_order.delivery_location::geometry),
    'dropoff_lng', st_x(p_order.delivery_location::geometry),
    'delivery_address', p_order.delivery_address,
    'delivery_note', p_order.delivery_note,
    'item_count', (select coalesce(sum(qty), 0)::integer from order_items where order_id = p_order.id),
    'total_kobo', p_order.total_kobo,
    'delivery_fee_kobo', p_order.delivery_fee_kobo,
    'distance_m', p_order.distance_m,
    'pickup_distance_m', round(v_pickup_m)::integer,
    'rider_fee_estimate_kobo', v_estimate,
    'customer_name', v_customer.full_name,
    'customer_phone', v_customer.phone);
end;
$$;

-- ===========================================================================
-- 3. The core: accept / decline
-- ===========================================================================

-- p_rider always comes from auth.uid() in the caller, never from a client
-- parameter. Outcomes (never raises for a normal race):
--   accepted | already_yours | taken | expired | withdrawn | declined | not_found
--   | ineligible (reason: kyc | inactive | busy | location | unfundable)
create or replace function _dispatch_respond(p_offer_id uuid, p_rider uuid, p_action text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_order_id uuid;
  v_order    orders;
  v_rider    riders;
  v_offer    dispatch_offers;
  v_adv      jsonb;
  v_reason   text;
  v_fee      bigint;
  v_pickup   integer;
  v_fundable boolean;
  v_early    boolean;
begin
  if p_action is null or p_action not in ('accept', 'decline') then
    raise exception '_dispatch_respond: action must be accept or decline'
      using errcode = 'check_violation';
  end if;
  if p_rider is null then
    raise exception '_dispatch_respond: no authenticated caller' using errcode = 'insufficient_privilege';
  end if;

  select d.order_id into v_order_id from dispatch_offers d where d.id = p_offer_id and d.rider_id = p_rider;
  if not found then
    return _dispatch_not_found(p_offer_id);
  end if;

  -- orders -> riders -> order_dispatch -> dispatch_offers
  select * into v_order from orders where id = v_order_id for update;
  select * into v_rider from riders where user_id = p_rider for update;
  perform 1 from order_dispatch where order_id = v_order_id for update;
  select * into v_offer from dispatch_offers where id = p_offer_id for update;

  -- ---------------------------------------------------------------- decline
  if p_action = 'decline' then
    if v_offer.status = 'offered' then
      -- Allowed even past expires_at (a rider declining is never harmful).
      update dispatch_offers set status = 'declined', close_reason = 'rider_declined'
      where id = v_offer.id returning * into v_offer;
      perform _dispatch_log(v_order.id, 'offer_declined', jsonb_build_object('reason', 'rider_declined'), v_offer.id, p_rider);
      -- The next rider is asked in this same transaction: no timeout wait.
      begin
        v_adv := _dispatch_advance(v_order.id, 'decline');
      exception when others then
        raise warning '_dispatch_respond: advance after decline failed for order % - %', v_order.id, sqlerrm;
        v_adv := jsonb_build_object('outcome', 'error');
        update order_dispatch set next_check_at = now() where order_id = v_order.id;
      end;
      return _dispatch_outcome('declined', v_offer, null, jsonb_build_object('next', v_adv ->> 'outcome'));
    end if;
    return _dispatch_outcome(
      case v_offer.status when 'declined' then 'declined' when 'expired' then 'expired'
                          when 'accepted' then 'already_yours' else 'withdrawn' end,
      v_offer, case when v_offer.status = 'accepted' then 'cannot_decline_accepted' end);
  end if;

  -- ----------------------------------------------------------------- accept
  -- Idempotent replay: the order is already this rider's.
  if v_order.rider_id = p_rider then
    return _dispatch_outcome('already_yours', v_offer);
  end if;
  if v_order.delivery_by = 'vendor' then
    return _dispatch_outcome('withdrawn', v_offer, 'vendor_delivery');
  end if;
  if v_order.rider_id is not null or v_order.status not in ('accepted', 'preparing', 'ready_for_pickup') then
    perform _dispatch_log(v_order.id,
      case when v_order.rider_id is not null then 'accept_conflict' else 'stale_accept_rejected' end,
      jsonb_build_object('order_status', v_order.status, 'assigned_to_other', v_order.rider_id is not null,
                         'offer_status', v_offer.status),
      v_offer.id, p_rider);
    return _dispatch_outcome('taken', v_offer, case when v_order.rider_id is not null then 'assigned_to_other' else 'not_ready' end);
  end if;

  if v_offer.status = 'declined' then
    return _dispatch_outcome('declined', v_offer);
  elsif v_offer.status = 'expired' then
    return _dispatch_outcome('expired', v_offer);
  elsif v_offer.status <> 'offered' then
    return _dispatch_outcome('withdrawn', v_offer, v_offer.close_reason);
  end if;

  -- A live offer past its expiry: close it and ask the next rider right now.
  if v_offer.expires_at <= now() then
    perform _dispatch_close_live_offer(v_order.id, 'expired', 'timeout');
    perform _dispatch_log(v_order.id, 'stale_accept_rejected', jsonb_build_object('reason', 'expired'), v_offer.id, p_rider);
    begin
      v_adv := _dispatch_advance(v_order.id, 'offer_expired');
    exception when others then
      raise warning '_dispatch_respond: advance after expiry failed for order % - %', v_order.id, sqlerrm;
      v_adv := jsonb_build_object('outcome', 'error');
      update order_dispatch set next_check_at = now() where order_id = v_order.id;
    end;
    select * into v_offer from dispatch_offers where id = v_offer.id;
    return _dispatch_outcome('expired', v_offer, null, jsonb_build_object('next', v_adv ->> 'outcome'));
  end if;

  -- The rider must still be able to do the job (the fee is frozen from a LIVE position).
  v_reason := case
    when v_rider.kyc_status <> 'approved' then 'kyc'
    when (select status from profiles where id = p_rider) is distinct from 'active' then 'inactive'
    when exists (select 1 from orders o
                 where o.rider_id = p_rider and o.id <> v_order.id
                   and o.status in ('accepted', 'preparing', 'rider_assigned', 'picked_up', 'in_transit', 'arrived')) then 'busy'
    when not v_rider.is_online or v_rider.current_location is null or v_rider.last_ping_at is null
         or v_rider.last_ping_at < now() - interval '5 minutes' then 'location'
  end;
  if v_reason is null then
    select q.fee_kobo, q.pickup_distance_m, q.fundable into v_fee, v_pickup, v_fundable
    from _quote_rider_fee(v_order.id, p_rider) q;
    if not v_fundable then
      v_reason := 'unfundable';
    end if;
  end if;
  if v_reason is not null then
    perform _dispatch_log(v_order.id, 'stale_accept_rejected', jsonb_build_object('reason', v_reason), v_offer.id, p_rider);
    return _dispatch_outcome('ineligible', v_offer, v_reason);
  end if;

  v_early := v_order.status <> 'ready_for_pickup';
  if not v_early then
    -- ready -> rider_assigned straight away: the food is already ready.
    if not exists (select 1 from order_status_transitions where from_status = 'ready_for_pickup' and to_status = 'rider_assigned') then
      raise exception '_dispatch_respond: ready_for_pickup -> rider_assigned is not a legal transition';
    end if;
    update orders
    set rider_id = p_rider, status = 'rider_assigned', assigned_at = now(),
        rider_fee_kobo = v_fee, rider_pickup_distance_m = v_pickup
    where id = v_order.id returning * into v_order;
    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (v_order.id, 'ready_for_pickup', 'rider_assigned', 'rider', p_rider, '{}'::jsonb);
  else
    -- Early accept (0064): rider_id and fee now, status untouched; the ready
    -- trigger cascades to rider_assigned later.
    update orders
    set rider_id = p_rider, rider_fee_kobo = v_fee, rider_pickup_distance_m = v_pickup
    where id = v_order.id returning * into v_order;
    insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
    values (v_order.id, v_order.status, v_order.status, 'rider', p_rider,
            jsonb_build_object('early_accept', true, 'order_status_at_accept', v_order.status));
  end if;

  update dispatch_offers set status = 'accepted' where id = v_offer.id returning * into v_offer;
  perform _dispatch_close_live_offer(v_order.id, 'superseded', 'order_assigned');
  perform _dispatch_stamp_assigned_eta(v_order.id);
  perform _dispatch_log(v_order.id, 'offer_accepted',
    jsonb_build_object('path', case when v_early then 'early' else 'ready' end, 'fee_kobo', v_fee, 'pickup_distance_m', v_pickup),
    v_offer.id, p_rider);

  return _dispatch_outcome('accepted', v_offer, null, jsonb_build_object('order_status', v_order.status::text));
end;
$$;

-- ===========================================================================
-- 4. Rider RPCs
-- ===========================================================================

-- Same name, argument and return type as ever. NEW: the rider who already holds
-- the order gets the order row back (was an error).
-- An accept that arrives after the offer expired raises 'offer has expired'; that
-- raise rolls back the expire + advance the core just did. Chosen on purpose:
-- the legacy contract is an error, and the tick (0103) expires the offer and
-- asks the next rider within seconds anyway. respond_to_dispatch_offer returns
-- the outcome instead and keeps the advance.
create or replace function accept_dispatch_offer(p_order_id uuid)
returns orders
language plpgsql security definer set search_path to 'public' as $$
declare
  v_offer_id uuid;
  v_res      jsonb;
  v_order    orders;
begin
  perform _assert_active_caller();
  perform _dispatch_rate_check(auth.uid());

  v_offer_id := _dispatch_pick_offer(p_order_id, auth.uid());
  if v_offer_id is null then
    select * into v_order from orders where id = p_order_id;
    if not found then
      raise exception 'accept_dispatch_offer: order % does not exist', p_order_id using errcode = 'no_data_found';
    end if;
    if v_order.delivery_by = 'vendor' then
      raise exception 'accept_dispatch_offer: this order is being delivered by the vendor and no longer needs a rider'
        using errcode = 'check_violation';
    end if;
    if v_order.status not in ('accepted', 'preparing', 'ready_for_pickup') or v_order.rider_id is not null then
      raise exception 'accept_dispatch_offer: order already assigned or not ready for pickup';
    end if;
    raise exception 'accept_dispatch_offer: no active offer for this rider on this order';
  end if;

  v_res := _dispatch_respond(v_offer_id, auth.uid(), 'accept');

  case v_res ->> 'outcome'
    when 'accepted', 'already_yours' then
      select * into v_order from orders where id = p_order_id;
      return v_order;
    when 'taken' then
      raise exception 'accept_dispatch_offer: order already assigned or not ready for pickup';
    when 'expired' then
      raise exception 'accept_dispatch_offer: offer has expired';
    when 'ineligible' then
      case v_res ->> 'reason'
        when 'kyc' then
          raise exception 'accept_dispatch_offer: rider is not kyc-approved';
        when 'inactive' then
          raise exception 'accept_dispatch_offer: the calling account is not active' using errcode = 'insufficient_privilege';
        when 'busy' then
          raise exception 'accept_dispatch_offer: rider already has an active order' using errcode = 'check_violation';
        when 'location' then
          raise exception 'accept_dispatch_offer: rider must be online with a location update from the last 5 minutes to accept';
        else
          raise exception 'accept_dispatch_offer: order % is too far from this rider - the payout would exceed what the order can fund', p_order_id
            using errcode = 'check_violation';
      end case;
    else
      if v_res ->> 'reason' = 'vendor_delivery' then
        raise exception 'accept_dispatch_offer: this order is being delivered by the vendor and no longer needs a rider'
          using errcode = 'check_violation';
      end if;
      raise exception 'accept_dispatch_offer: no active offer for this rider on this order';
  end case;
end;
$$;

-- Returns the (now closed) offer row. A repeat returns the same row again.
-- Any other state (expired, withdrawn, already accepted, no offer) still raises
-- 'no active offer for this rider on this order', which the app treats as a no-op.
create or replace function decline_dispatch_offer(p_order_id uuid)
returns dispatch_offers
language plpgsql security definer set search_path to 'public' as $$
declare
  v_offer_id uuid;
  v_res      jsonb;
  v_offer    dispatch_offers;
begin
  perform _assert_active_caller();
  perform _dispatch_rate_check(auth.uid());

  v_offer_id := _dispatch_pick_offer(p_order_id, auth.uid());
  if v_offer_id is not null then
    v_res := _dispatch_respond(v_offer_id, auth.uid(), 'decline');
    if v_res ->> 'outcome' = 'declined' then
      select * into v_offer from dispatch_offers where id = v_offer_id;
      return v_offer;
    end if;
  end if;
  raise exception 'decline_dispatch_offer: no active offer for this rider on this order';
end;
$$;

-- Outcome-returning twin of the two above, for opening a push notification.
create or replace function respond_to_dispatch_offer(p_offer_id uuid, p_action text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  perform _assert_active_caller();
  if p_action is null or p_action not in ('accept', 'decline') then
    raise exception 'respond_to_dispatch_offer: action must be accept or decline, got %', coalesce(p_action, 'null')
      using errcode = 'check_violation';
  end if;
  perform _dispatch_rate_check(auth.uid());
  return _dispatch_respond(p_offer_id, auth.uid(), p_action);
end;
$$;

-- Authoritative state of the caller's OWN offer. Order details only while the
-- offer is live (or the rider holds the order); the customer's name and phone
-- only for the rider who holds the order (0072). Anyone else's offer id answers
-- exactly like an id that does not exist.
create or replace function get_dispatch_offer(p_offer_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_offer  dispatch_offers;
  v_order  orders;
  v_live   boolean;
  v_holds  boolean;
begin
  perform _assert_active_caller();

  select * into v_offer from dispatch_offers where id = p_offer_id and rider_id = auth.uid();
  if not found then
    return _dispatch_not_found(p_offer_id) || jsonb_build_object('actionable', false, 'order', null);
  end if;
  select * into v_order from orders where id = v_offer.order_id;

  v_live := v_offer.status = 'offered' and v_offer.expires_at > now();
  v_holds := v_order.rider_id = auth.uid();

  return _dispatch_outcome('found', v_offer, null, jsonb_build_object(
    'cycle_no', v_offer.cycle_no,
    'attempt_no', v_offer.attempt_no,
    'ring', v_offer.ring,
    'distance_m', v_offer.distance_m,
    'eta_seconds', v_offer.eta_seconds,
    'order_status', v_order.status::text,
    'actionable', v_live and v_order.rider_id is null and v_order.delivery_by = 'rider'
                  and v_order.status in ('accepted', 'preparing', 'ready_for_pickup'),
    'holds_order', v_holds,
    'order', case when v_live or v_holds then _rider_offer_detail_json(v_order, auth.uid()) end));
end;
$$;

-- ===========================================================================
-- 5. Admin
-- ===========================================================================

-- Re-dispatch core with a real trigger name. The old two-argument form stays as
-- a thin wrapper (trigger 'redispatch') for anything that still calls it.
create or replace function _redispatch_core(p_order_id uuid, p_widen boolean, p_trigger text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v jsonb;
begin
  -- Anchor for the 30 minute give-up, same as the sweep.
  update orders set first_dispatched_at = now()
  where id = p_order_id and status = 'ready_for_pickup' and first_dispatched_at is null;

  -- An admin asking for riders now does not wait for the predicted start.
  if p_trigger = 'admin_redispatch' then
    update order_dispatch set start_at = now()
    where order_id = p_order_id and state = 'scheduled' and start_at > now();
    if found then
      perform _dispatch_log(p_order_id, 'start_recomputed', jsonb_build_object('reason', 'admin_redispatch'));
    end if;
  end if;

  v := _dispatch_advance(p_order_id, p_trigger, coalesce(p_widen, true));
  return jsonb_build_object(
    'offers_created', (v ->> 'outcome' = 'offered')::integer,
    'riders_in_range', (v ->> 'in_range_riders')::integer,
    'radius_m', (v ->> 'radius_m')::integer,
    'tier', coalesce(v ->> 'tier', 'base'),
    'outcome', v ->> 'outcome',
    'offer_id', v ->> 'offer_id',
    'live_offer', v ->> 'outcome' = 'waiting');
end;
$$;

create or replace function _redispatch_core(p_order_id uuid, p_widen boolean)
returns jsonb
language sql security definer set search_path to 'public' as $$
  select _redispatch_core(p_order_id, p_widen, 'redispatch')
$$;

create or replace function admin_redispatch_order(p_order_id uuid, p_reason text, p_actor_id uuid, p_widen boolean default true)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_reason  text;
  v_order   orders;
  v_result  jsonb;
begin
  perform _assert_admin_actor('admin_redispatch_order', p_actor_id);
  v_reason := _admin_reason('admin_redispatch_order', p_reason, true);

  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'admin_redispatch_order: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if v_order.status not in ('ready_for_pickup', 'accepted', 'preparing') then
    raise exception 'admin_redispatch_order: order % is % - only an order waiting for a rider (ready_for_pickup, accepted, preparing) can be re-dispatched', v_order.code, v_order.status
      using errcode = 'check_violation';
  end if;
  if v_order.rider_id is not null then
    raise exception 'admin_redispatch_order: order % already has a rider', v_order.code
      using errcode = 'check_violation';
  end if;
  if v_order.delivery_by = 'vendor' then
    raise exception 'admin_redispatch_order: order % is being delivered by the vendor themselves', v_order.code
      using errcode = 'check_violation';
  end if;

  -- With a live offer the engine keeps it ('waiting', offers_created 0): no double offer.
  v_result := _redispatch_core(p_order_id, p_widen, 'admin_redispatch');

  perform _write_admin_audit(
    p_actor_id, 'order.redispatch', 'order', p_order_id, v_reason,
    jsonb_build_object(
      'status', v_order.status,
      'widen', coalesce(p_widen, true),
      'tier', v_result -> 'tier',
      'radius_m', v_result -> 'radius_m',
      'offers_created', v_result -> 'offers_created',
      'riders_in_range', v_result -> 'riders_in_range',
      'outcome', v_result -> 'outcome'
    )
  );

  return v_result;
end;
$$;

create or replace function admin_reassign_order_rider(p_order_id uuid, p_rider_id uuid, p_reason text, p_actor_id uuid)
returns orders
language plpgsql security definer set search_path to 'public' as $$
declare
  v_reason      text;
  v_order       orders;
  v_from_status order_status;
  v_fee_before  bigint;
  v_previous    uuid;
  v_blocker     text;
  v_fee         bigint;
  v_pickup_m    integer;
  v_fundable    boolean;
  v_live_offers integer;
  v_cycle       integer;
  v_attempt     integer;
  v_offer_id    uuid;
  v_mode        text := case when p_rider_id is null then 'reoffer' else 'assign' end;
begin
  perform _assert_admin_actor('admin_reassign_order_rider', p_actor_id);
  v_reason := _admin_reason('admin_reassign_order_rider', p_reason, true);

  -- orders -> riders -> order_dispatch -> dispatch_offers, like a rider's accept.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'admin_reassign_order_rider: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  if v_order.status not in ('accepted', 'preparing', 'ready_for_pickup', 'rider_assigned') then
    raise exception 'admin_reassign_order_rider: order % is % - a rider can only be changed before pickup', v_order.code, v_order.status
      using errcode = 'check_violation';
  end if;

  if v_order.delivery_by = 'vendor' then
    raise exception 'admin_reassign_order_rider: order % is being delivered by the vendor themselves - it has no rider to change', v_order.code
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

  perform 1 from order_dispatch where order_id = p_order_id for update;

  -- Take the current rider off the order.
  if v_previous is not null then
    update dispatch_offers
    set status = 'revoked', close_reason = 'admin_reassigned'
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

    -- The live offer (if any) is replaced by the admin's choice.
    perform _dispatch_close_live_offer(p_order_id, 'superseded', 'admin_assigned');

    -- One NEW accepted offer, explicitly numbered: this cycle, next attempt.
    select greatest(coalesce(max(d.attempt_no), 0), coalesce((select attempt_no from order_dispatch where order_id = p_order_id), 0)) + 1
      into v_attempt from dispatch_offers d where d.order_id = p_order_id;
    select greatest(coalesce((select cycle_no from order_dispatch where order_id = p_order_id), 0), 1) into v_cycle;
    insert into dispatch_offers (order_id, rider_id, status, cycle_no, attempt_no, expires_at, responded_at, close_reason)
    values (p_order_id, p_rider_id, 'accepted', v_cycle, v_attempt, now(), now(), null)
    returning id into v_offer_id;

    update order_dispatch set cycle_no = v_cycle, attempt_no = v_attempt where order_id = p_order_id;
    perform _dispatch_stamp_assigned_eta(p_order_id);
    perform _dispatch_log(p_order_id, 'offer_accepted', jsonb_build_object('path', 'admin_assign'), v_offer_id, p_rider_id);

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
      -- The admin wants a rider now, not at the predicted start.
      update order_dispatch set start_at = now() where order_id = p_order_id and start_at > now();
    end if;
    perform _dispatch_advance(p_order_id, 'admin_reoffer');
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
$$;

-- Settings: every D10 key with its bounds (they mirror the platform_settings
-- CHECK) plus the cross-row rule initial ring <= max ring.
create or replace function admin_set_dispatch_setting(p_key text, p_value integer, p_reason text, p_actor_id uuid)
returns platform_settings
language plpgsql security definer set search_path to 'public' as $$
declare
  v_row      platform_settings;
  v_before   bigint;
  v_reason   text;
  v_lo       integer;
  v_hi       integer;
  v_label    text;
  v_initial  bigint;
  v_max      bigint;
begin
  perform _assert_admin_actor('admin_set_dispatch_setting', p_actor_id, 'admin');
  v_reason := _admin_reason('admin_set_dispatch_setting', p_reason, true);

  if p_key is null or p_value is null then
    raise exception 'admin_set_dispatch_setting: a setting and a value are required'
      using errcode = 'check_violation';
  end if;

  if p_key = 'dispatch_radius_m' then
    if p_value <> 0 and p_value not between 1000 and 50000 then
      raise exception 'admin_set_dispatch_setting: the first-round dispatch radius must be 0 (no limit) or between 1000 and 50000 metres, got %', p_value
        using errcode = 'check_violation';
    end if;
  elsif p_key = 'dispatch_max_riders' then
    if p_value not between 1 and 50 then
      raise exception 'admin_set_dispatch_setting: riders per round must be between 1 and 50, got %', p_value
        using errcode = 'check_violation';
    end if;
  elsif p_key = 'dispatch_widen_after_seconds' then
    if p_value not between 0 and 1800 then
      raise exception 'admin_set_dispatch_setting: the widen delay must be between 0 (never) and 1800 seconds, got %', p_value
        using errcode = 'check_violation';
    end if;
  elsif p_key = 'dispatch_notify_vendor_after_seconds' then
    if p_value not between 0 and 1800 then
      raise exception 'admin_set_dispatch_setting: the vendor-notification delay must be between 0 (off) and 1800 seconds, got %', p_value
        using errcode = 'check_violation';
    end if;
  elsif p_key = 'dispatch_location_max_age_seconds' then
    if p_value not between 60 and 300 then
      raise exception 'admin_set_dispatch_setting: the location freshness window must be between 60 and 300 seconds (a rider pinging over 5 minutes ago cannot accept an offer), got %', p_value
        using errcode = 'check_violation';
    end if;
  else
    select b.lo, b.hi, b.label into v_lo, v_hi, v_label
    from (values
      ('dispatch_offer_timeout_seconds',  15, 120,  'the time a rider has to answer an offer (seconds)'),
      ('dispatch_h3_resolution',           7,   9,  'the search area size (map grid level)'),
      ('dispatch_h3_initial_ring',         0,  10,  'the number of first search rings'),
      ('dispatch_h3_max_ring',             1,  30,  'the furthest search ring'),
      ('dispatch_secure_buffer_seconds',  45, 900,  'the time allowed to find a rider (seconds)'),
      ('dispatch_default_travel_seconds', 60, 3600, 'the rider travel time when it is not known (seconds)'),
      ('dispatch_default_speed_kmh',       5,  60,  'the rider average speed (km/h)'),
      ('dispatch_road_factor_pct',       100, 250,  'the road distance compared with a straight line (percent)'),
      ('dispatch_min_history_samples',     5, 1000, 'the number of deliveries needed before learning from history'),
      ('dispatch_vendor_arrival_radius_m',30, 500,  'the distance that counts as being at the store (metres)')
    ) as b(key, lo, hi, label) where b.key = p_key;
    if not found then
      raise exception 'admin_set_dispatch_setting: unknown dispatch setting %', p_key
        using errcode = 'check_violation';
    end if;
    if p_value not between v_lo and v_hi then
      raise exception 'admin_set_dispatch_setting: % must be between % and %, got %', v_label, v_lo, v_hi, p_value
        using errcode = 'check_violation';
    end if;
  end if;

  -- Both ring rows are locked together (fixed order) when either one changes.
  if p_key in ('dispatch_h3_initial_ring', 'dispatch_h3_max_ring') then
    perform 1 from platform_settings where key in ('dispatch_h3_initial_ring', 'dispatch_h3_max_ring') order by key for update;
  end if;

  select * into v_row from platform_settings where key = p_key for update;
  if not found then
    raise exception 'admin_set_dispatch_setting: setting % is not configured', p_key
      using errcode = 'no_data_found';
  end if;

  v_before := v_row.value_int;
  if v_before = p_value then
    return v_row;
  end if;

  if p_key = 'dispatch_h3_initial_ring' then
    select value_int into v_max from platform_settings where key = 'dispatch_h3_max_ring';
    if p_value > v_max then
      raise exception 'admin_set_dispatch_setting: the number of first search rings (%) cannot be more than the furthest search ring (%). Raise the furthest ring first.', p_value, v_max
        using errcode = 'check_violation';
    end if;
  elsif p_key = 'dispatch_h3_max_ring' then
    select value_int into v_initial from platform_settings where key = 'dispatch_h3_initial_ring';
    if p_value < v_initial then
      raise exception 'admin_set_dispatch_setting: the furthest search ring (%) cannot be less than the number of first search rings (%). Lower the first rings first.', p_value, v_initial
        using errcode = 'check_violation';
    end if;
  end if;

  update platform_settings
  set value_int = p_value, updated_at = now(), updated_by = p_actor_id
  where key = p_key
  returning * into v_row;

  perform _write_admin_audit(p_actor_id, 'dispatch_setting.set', 'platform_setting', v_row.id, v_reason,
    jsonb_build_object('key', p_key, 'unit', v_row.unit, 'from', v_before, 'to', p_value));

  return v_row;
end;
$$;

-- Overview (D11). Existing keys are kept; per order it adds the engine state.
-- Orders listed: ready_for_pickup, or accepted/preparing whose dispatch has
-- started (state searching / offered / needs_attention), with no rider, that
-- have waited over 60 s. `upcoming` lists the ones still scheduled.
create or replace function admin_dispatch_status()
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
  v_radius      integer := _platform_setting_int('dispatch_radius_m')::integer;
  v_widen_after integer := _platform_setting_int('dispatch_widen_after_seconds')::integer;
  v_result      jsonb;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'admin_dispatch_status: requires the service-role key';
  end if;

  select jsonb_build_object(
    'settings', jsonb_build_object(
      'radius_m', v_radius,
      'max_riders', _platform_setting_int('dispatch_max_riders'),
      'widen_after_seconds', v_widen_after,
      'location_max_age_seconds', _platform_setting_int('dispatch_location_max_age_seconds'),
      'notify_vendor_after_seconds', _platform_setting_int('dispatch_notify_vendor_after_seconds'),
      'offer_timeout_seconds', _platform_setting_int('dispatch_offer_timeout_seconds'),
      'h3_resolution', _platform_setting_int('dispatch_h3_resolution'),
      'h3_initial_ring', _platform_setting_int('dispatch_h3_initial_ring'),
      'h3_max_ring', _platform_setting_int('dispatch_h3_max_ring'),
      'secure_buffer_seconds', _platform_setting_int('dispatch_secure_buffer_seconds'),
      'default_travel_seconds', _platform_setting_int('dispatch_default_travel_seconds'),
      'default_speed_kmh', _platform_setting_int('dispatch_default_speed_kmh'),
      'road_factor_pct', _platform_setting_int('dispatch_road_factor_pct'),
      'min_history_samples', _platform_setting_int('dispatch_min_history_samples'),
      'vendor_arrival_radius_m', _platform_setting_int('dispatch_vendor_arrival_radius_m')
    ),
    'online_riders', (select count(*) from riders where is_online and kyc_status = 'approved'),
    'needs_attention_count', (
      select count(*) from order_dispatch od where od.state = 'needs_attention'),
    'stuck_orders', coalesce((
      select jsonb_agg(x.js order by x.waiting_since)
      from (
        select w.waiting_since,
          jsonb_build_object(
            'order_id', w.order_id,
            'code', o.code,
            'vendor_id', o.vendor_id,
            'vendor_name', v.name,
            'status', w.status,
            'waiting_since', w.waiting_since,
            'delivery_by', o.delivery_by,
            'offers_made', ac.n,
            'offers_open', case when lo.id is not null then 1 else 0 end,
            'nearest_online_rider_m', f.nearest_online_m,
            'riders_within_radius', f.in_range1,
            'store_radius_m', sr.store_radius_m,
            'riders_within_store_radius', f.in_range2,
            'last_attempt', (
              select jsonb_build_object('at', a.attempted_at, 'radius_m', a.radius_m,
                                        'riders_in_range', a.riders_in_range, 'offers_created', a.offers_created)
              from dispatch_attempts a where a.order_id = w.order_id
              order by a.attempted_at desc limit 1
            ),
            'reason', rs.reason,
            'widened', widened.is_widened,
            'eligible_riders', ce.eligible_riders,
            'fundable_riders_in_range', ce.fundable_riders,
            'dispatch_state', od.state,
            'live_offer', case when lo.id is null then null else jsonb_build_object(
              'offer_id', lo.id, 'rider_id', lo.rider_id, 'rider_name', lo.full_name, 'attempt_no', lo.attempt_no,
              'seconds_left', greatest(0, ceil(extract(epoch from lo.expires_at - now()))::integer),
              'eta_seconds', lo.eta_seconds) end,
            'cycle_no', od.cycle_no,
            'attempts_made', ac.n,
            'start_at', od.start_at,
            'expected_ready_at', od.expected_ready_at,
            'needs_attention', (od.needs_attention_since is not null or rs.reason = 'needs_attention'),
            'attention_reason', od.attention_reason
          ) as js
        from (
          select o2.id as order_id, o2.status,
                 case when o2.status = 'ready_for_pickup' then _dispatch_wait_start(o2, v2.avg_prep_mins)
                      else coalesce(od2.start_at, _dispatch_wait_start(o2, v2.avg_prep_mins)) end as waiting_since
          from orders o2
          join vendors v2 on v2.id = o2.vendor_id
          left join order_dispatch od2 on od2.order_id = o2.id
          where o2.rider_id is null and o2.delivery_by = 'rider'
            and o2.status in ('ready_for_pickup', 'accepted', 'preparing')
            and (o2.status = 'ready_for_pickup'
                 or od2.state in ('searching', 'offered', 'needs_attention')
                 or (od2.order_id is null and o2.accepted_at is not null
                     and now() >= _dispatch_wait_start(o2, v2.avg_prep_mins)))
        ) w
        join orders o on o.id = w.order_id
        join vendors v on v.id = o.vendor_id
        left join order_dispatch od on od.order_id = w.order_id
        cross join lateral (select count(*)::integer as n from dispatch_offers d where d.order_id = w.order_id) ac
        left join lateral (
          select d.id, d.rider_id, d.attempt_no, d.expires_at, d.eta_seconds, p.full_name
          from dispatch_offers d left join profiles p on p.id = d.rider_id
          where d.order_id = w.order_id and d.status = 'offered' and d.expires_at > now()
        ) lo on true
        cross join lateral (select _dispatch_store_radius_m(o.vendor_id) as store_radius_m) sr
        cross join lateral (select v_radius > 0 and v_widen_after > 0
                                   and now() >= w.waiting_since + make_interval(secs => v_widen_after) as is_widened) widened
        cross join lateral _dispatch_rider_funnel(w.order_id, nullif(v_radius, 0), sr.store_radius_m) f
        cross join lateral (select f.eligible_riders as eligible_riders,
                                   case when widened.is_widened then f.in_range2 else f.in_range1 end as in_range_riders,
                                   case when widened.is_widened then f.fundable2 else f.fundable1 end as fundable_riders) ce
        cross join lateral (select case
            when lo.id is not null then 'waiting_for_rider_reply'
            when w.status <> 'ready_for_pickup' and od.state = 'scheduled' and od.start_at > now() then 'scheduled'
            when ce.eligible_riders = 0 then 'no_online_riders'
            when ce.in_range_riders = 0 then 'none_in_range'
            when ce.fundable_riders = 0 then 'fee_exceeds_order_budget'
            when ac.n > 0 then 'all_declined_or_expired'
            else 'needs_attention'
          end as reason) rs
        where w.waiting_since < now() - interval '60 seconds'
        order by w.waiting_since
        limit 50
      ) x
    ), '[]'::jsonb),
    'upcoming', coalesce((
      select jsonb_agg(u.js order by u.start_at)
      from (
        select od.start_at,
          jsonb_build_object(
            'order_id', o.id, 'code', o.code, 'vendor_id', o.vendor_id, 'vendor_name', v.name, 'status', o.status,
            'accepted_at', o.accepted_at, 'expected_ready_at', od.expected_ready_at, 'start_at', od.start_at,
            'starts_in_seconds', greatest(0, ceil(extract(epoch from od.start_at - now()))::integer),
            'dispatch_state', od.state) as js
        from order_dispatch od
        join orders o on o.id = od.order_id
        join vendors v on v.id = o.vendor_id
        where od.state = 'scheduled' and od.start_at > now()
          and o.status in ('accepted', 'preparing') and o.rider_id is null and o.delivery_by = 'rider'
        order by od.start_at
        limit 50
      ) u
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- Everything the engine did for one order. Same gate as admin_dispatch_status.
create or replace function admin_dispatch_order_history(p_order_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
  v_order       orders;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'admin_dispatch_order_history: requires the service-role key';
  end if;
  select * into v_order from orders where id = p_order_id;
  if not found then
    raise exception 'admin_dispatch_order_history: order % does not exist', p_order_id
      using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'order', jsonb_build_object('id', v_order.id, 'code', v_order.code, 'status', v_order.status,
                                'delivery_by', v_order.delivery_by, 'rider_id', v_order.rider_id),
    'dispatch', (select to_jsonb(od) from order_dispatch od where od.order_id = p_order_id),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'offer_id', d.id, 'rider_id', d.rider_id, 'rider_name', p.full_name,
        'cycle_no', d.cycle_no, 'attempt_no', d.attempt_no, 'ring', d.ring, 'radius_m', d.radius_m,
        'distance_m', d.distance_m, 'eta_seconds', d.eta_seconds,
        'status', d.status, 'close_reason', d.close_reason,
        'offered_at', d.offered_at, 'expires_at', d.expires_at, 'responded_at', d.responded_at,
        'seconds_to_respond', case when d.responded_at is null then null
                                   else round(extract(epoch from d.responded_at - d.offered_at)::numeric, 1) end)
        order by d.attempt_no)
      from dispatch_offers d left join profiles p on p.id = d.rider_id
      where d.order_id = p_order_id), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', e.at, 'event', e.event, 'cycle_no', e.cycle_no, 'attempt_no', e.attempt_no,
        'offer_id', e.offer_id, 'rider_id', e.rider_id, 'data', e.data) order by e.at, e.id)
      from (select * from dispatch_events where order_id = p_order_id order by at desc, id desc limit 200) e),
      '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- 6. Vendor
-- ===========================================================================

create or replace function _vendor_dispatch_view(p_order orders)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_radius        integer := _platform_setting_int('dispatch_radius_m')::integer;
  v_widen_after   integer := _platform_setting_int('dispatch_widen_after_seconds')::integer;
  v_notify_after  integer := _platform_setting_int('dispatch_notify_vendor_after_seconds')::integer;
  v_avg_prep      integer;
  v_waiting_since timestamptz;
  v_store         integer;
  v_eff           integer;
  v_widened       boolean;
  v_can_widen     boolean;
  v_count         integer;
  v_last          timestamptz;
  v_state         text;
  v_in_range      integer := 0;
  v_open          boolean;
  v_wait_s        integer;
  v_od            order_dispatch;
  v_extra         jsonb;
  v_started       boolean;
  c               record;
begin
  select avg_prep_mins into v_avg_prep from vendors where id = p_order.vendor_id;
  v_store := _dispatch_store_radius_m(p_order.vendor_id);

  select * into v_od from order_dispatch where order_id = p_order.id;
  -- Added in 0102; the keys above stay as they were.
  v_extra := jsonb_build_object(
    'dispatch_state', v_od.state,
    'expected_ready_at', v_od.expected_ready_at,
    'start_at', v_od.start_at,
    'searching_since', v_od.dispatch_started_at,
    'attempts_made', (select count(*)::integer from dispatch_offers where order_id = p_order.id),
    'assigned_eta_at', v_od.assigned_eta_at);

  if p_order.delivery_by = 'vendor' then
    v_state := 'self_delivery';
  elsif p_order.rider_id is not null then
    v_state := 'rider_assigned';
  elsif p_order.status not in ('ready_for_pickup', 'accepted', 'preparing') then
    v_state := 'not_applicable';
  end if;

  if v_state is not null then
    return jsonb_build_object('state', v_state, 'can_expand', false, 'expand_available_in_seconds', null,
                              'riders_in_range', 0, 'radius_m', nullif(v_radius, 0), 'base_radius_m', v_radius, 'store_radius_m', v_store)
           || v_extra;
  end if;

  -- Same clock as the engine: a not-yet-ready order is "waiting" from its
  -- predicted dispatch start.
  v_waiting_since := case when p_order.status = 'ready_for_pickup' then _dispatch_wait_start(p_order, v_avg_prep)
                          else coalesce(v_od.start_at, _dispatch_wait_start(p_order, v_avg_prep)) end;
  v_started := p_order.status = 'ready_for_pickup' or now() >= v_waiting_since;
  v_widened := v_radius > 0 and v_widen_after > 0 and now() >= v_waiting_since + make_interval(secs => v_widen_after);
  v_eff := case when v_radius = 0 then null when v_widened then v_store else v_radius end;
  -- A wider radius exists only when a cap is set and the store's radius exceeds
  -- the one in use.
  v_can_widen := v_radius > 0 and v_store > coalesce(v_eff, 0);

  select * into c from _dispatch_rider_counts(p_order.id, v_eff);
  v_in_range := c.in_range_riders;
  v_open := exists (select 1 from dispatch_offers d where d.order_id = p_order.id and d.status = 'offered' and d.expires_at > now());

  v_state := case
    when v_started and not v_open and v_in_range = 0 and now() >= v_waiting_since + make_interval(secs => v_notify_after) then 'no_rider_nearby'
    else 'offers_pending'
  end;

  select count(*), max(expanded_at) into v_count, v_last from dispatch_expansions where order_id = p_order.id;
  v_wait_s := case when v_last is null then 0 else greatest(0, ceil(extract(epoch from (v_last + interval '120 seconds' - now())))::integer) end;

  return jsonb_build_object(
    'state', v_state,
    'can_expand', v_started and v_can_widen and v_count < 3 and v_wait_s = 0,
    'expand_available_in_seconds', case when v_can_widen and v_count < 3 and v_wait_s > 0 then v_wait_s end,
    'riders_in_range', v_in_range,
    'radius_m', v_eff,
    'base_radius_m', v_radius,
    'store_radius_m', v_store,
    'expansions_used', v_count
  ) || v_extra;
end;
$$;

create or replace function vendor_expand_rider_search(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_order   orders;
  v_view    jsonb;
  v_result  jsonb;
begin
  v_order := _vendor_order_guard('vendor_expand_rider_search', p_order_id, true);

  if v_order.delivery_by = 'vendor' or v_order.rider_id is not null
     or v_order.status not in ('ready_for_pickup', 'accepted', 'preparing') then
    raise exception 'vendor_expand_rider_search: this order is not waiting for a rider'
      using errcode = 'check_violation';
  end if;

  v_view := _vendor_dispatch_view(v_order);

  if (v_view ->> 'expansions_used')::integer >= 3 then
    raise exception 'rate_limited: the rider search for this order can only be widened 3 times'
      using errcode = 'P0429';
  end if;
  if (v_view ->> 'expand_available_in_seconds') is not null then
    raise exception 'rate_limited: try again in % seconds', v_view ->> 'expand_available_in_seconds'
      using errcode = 'P0429';
  end if;
  if v_order.status <> 'ready_for_pickup' and (v_view ->> 'start_at')::timestamptz > now() then
    raise exception 'vendor_expand_rider_search: the rider search for this order has not started yet'
      using errcode = 'check_violation';
  end if;
  if not (v_view ->> 'can_expand')::boolean then
    raise exception 'vendor_expand_rider_search: riders are already being searched up to your full delivery radius'
      using errcode = 'check_violation';
  end if;

  v_result := _redispatch_core(p_order_id, true, 'vendor_expand');

  insert into dispatch_expansions (order_id, vendor_user_id, offers_created)
  values (p_order_id, auth.uid(), (v_result ->> 'offers_created')::integer);

  return v_result;
end;
$$;

create or replace function vendor_start_self_delivery(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_order  orders;
  v_store  text;
  v_closed integer;
begin
  v_order := _vendor_order_guard('vendor_start_self_delivery', p_order_id, true);

  if v_order.delivery_by = 'vendor' then
    return jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'delivery_by', 'vendor', 'changed', false);
  end if;
  if v_order.rider_id is not null then
    raise exception 'vendor_start_self_delivery: a rider is already assigned to order %', v_order.code
      using errcode = 'check_violation';
  end if;
  if v_order.status not in ('accepted', 'preparing', 'ready_for_pickup') then
    raise exception 'vendor_start_self_delivery: order % is % - you can only choose to deliver it yourself before it is picked up', v_order.code, v_order.status
      using errcode = 'check_violation';
  end if;
  if v_order.payment_status <> 'paid' then
    raise exception 'vendor_start_self_delivery: order % is not paid', v_order.code
      using errcode = 'check_violation';
  end if;

  perform 1 from order_dispatch where order_id = p_order_id for update;
  update orders set delivery_by = 'vendor' where id = p_order_id returning * into v_order;

  -- A queued "new offer" text for the live offer must not go out after it is gone.
  update message_outbox m
  set status = 'suppressed', suppress_reason = 'expired'
  from dispatch_offers d
  where d.order_id = p_order_id and d.status = 'offered'
    and m.dedupe_key = 'offer:' || d.id::text || ':sms' and m.status = 'queued';

  v_closed := _dispatch_close_live_offer(p_order_id, 'cancelled', 'vendor_self_delivery');
  update order_dispatch set state = 'stopped', next_check_at = null where order_id = p_order_id and state <> 'stopped';

  insert into order_events (order_id, from_status, to_status, actor_type, actor_id, meta)
  values (p_order_id, v_order.status, v_order.status, 'vendor', auth.uid(),
          jsonb_build_object('delivery_by', 'vendor', 'offers_closed', v_closed));

  select name into v_store from vendors where id = v_order.vendor_id;
  insert into notifications (customer_id, order_id, title, body)
  values (v_order.customer_id, p_order_id, 'Delivery update',
          format('%s will deliver your order %s themselves.', v_store, v_order.code));

  return jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'delivery_by', 'vendor', 'changed', true, 'offers_closed', v_closed);
end;
$$;

-- ===========================================================================
-- 7. Grants and comments
-- ===========================================================================

-- Internal: callable only from the definer functions above.
revoke all on function _dispatch_rate_check(uuid) from public, anon, authenticated, service_role;
revoke all on function _dispatch_outcome(text, dispatch_offers, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function _dispatch_not_found(uuid) from public, anon, authenticated, service_role;
revoke all on function _dispatch_pick_offer(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function _dispatch_stamp_assigned_eta(uuid) from public, anon, authenticated, service_role;
revoke all on function _rider_offer_detail_json(orders, uuid) from public, anon, authenticated, service_role;
revoke all on function _dispatch_respond(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function _redispatch_core(uuid, boolean, text) from public, anon, authenticated, service_role;
revoke all on function _redispatch_core(uuid, boolean) from public, anon, authenticated, service_role;

-- New rider RPCs: authenticated only.
revoke all on function respond_to_dispatch_offer(uuid, text) from public, anon, authenticated, service_role;
revoke all on function get_dispatch_offer(uuid) from public, anon, authenticated, service_role;
grant execute on function respond_to_dispatch_offer(uuid, text) to authenticated;
grant execute on function get_dispatch_offer(uuid) to authenticated;

-- New admin read: service role only, like admin_dispatch_status.
revoke all on function admin_dispatch_order_history(uuid) from public, anon, authenticated, service_role;
grant execute on function admin_dispatch_order_history(uuid) to service_role;

comment on function _dispatch_respond(uuid, uuid, text) is
  'Accept / decline core (0102, design D2/D5). Rider comes from auth.uid() in the caller. Locks orders -> riders -> order_dispatch -> dispatch_offers. Returns jsonb {outcome: accepted|already_yours|taken|expired|withdrawn|declined|not_found|ineligible, reason, offer_id, order_id, status, close_reason, seconds_left, ...}; never raises for a normal race. Decline advances the engine in the same transaction. Internal.';
comment on function accept_dispatch_offer(uuid) is
  'Legacy accept on the shared core (0102). Same name/argument/return type and error substrings as the rider app maps them. The rider who already holds the order gets the order row back (idempotent). An accept after expiry raises "offer has expired" (the raise rolls back the expire + advance; the tick does it). 30 responses per rider per rolling minute across accept/decline/respond (P0429 rate_limited:).';
comment on function decline_dispatch_offer(uuid) is
  'Legacy decline on the shared core (0102): returns the closed dispatch_offers row; a repeat returns the same row; the engine asks the next rider in the same transaction. No offer / not declinable raises "no active offer for this rider on this order". Rate limited with accept.';
comment on function respond_to_dispatch_offer(uuid, text) is
  'Accept or decline by offer id (0102). Returns the outcome jsonb instead of raising for races: accepted | already_yours | taken | expired | withdrawn | declined | not_found | ineligible(reason). Invalid action raises check_violation. 30 calls per rider per rolling minute (P0429 rate_limited:). authenticated only.';
comment on function get_dispatch_offer(uuid) is
  'Authoritative state of the caller''s OWN offer (0102): offer_id, order_id, status, close_reason, offered_at, expires_at, seconds_left (server clock), actionable, plus `order` (the get_rider_offer_details fields) only while the offer is live or the rider holds the order; customer name/phone only for the holder (0072). Another rider''s offer id answers like a missing one (status null, outcome not_found). authenticated only.';
comment on function admin_dispatch_order_history(uuid) is
  'Every offer (rider, cycle, attempt, ring, distance, ETA, status, close_reason, offered/responded, seconds_to_respond), the latest 200 dispatch_events and the order_dispatch row for one order. service_role only.';
comment on function admin_set_dispatch_setting(text, integer, text, uuid) is
  'Sets a dispatch key in platform_settings: dispatch_radius_m (0 = no limit, else 1000-50000), dispatch_max_riders (1-50, riders asked one at a time per round), dispatch_widen_after_seconds (0-1800), dispatch_notify_vendor_after_seconds (0-1800), dispatch_location_max_age_seconds (60-300), dispatch_offer_timeout_seconds (15-120), dispatch_h3_resolution (7-9), dispatch_h3_initial_ring (0-10), dispatch_h3_max_ring (1-30), dispatch_secure_buffer_seconds (45-900), dispatch_default_travel_seconds (60-3600), dispatch_default_speed_kmh (5-60), dispatch_road_factor_pct (100-250), dispatch_min_history_samples (5-1000), dispatch_vendor_arrival_radius_m (30-500). The first search rings may not exceed the furthest ring. A widened search uses the vendor''s own delivery radius (capped at 50000 m), not a setting. Admin tier (dispatch moves no money). Row-locked, audited (dispatch_setting.set, before/after), unchanged value is a no-op with no audit row. service_role only.';
comment on function admin_dispatch_status() is
  'Read-only dispatch overview: all dispatch settings, riders online, needs_attention_count, up to 50 orders with no rider that have waited over 60 s (`stuck_orders`, oldest first) and up to 50 orders still scheduled (`upcoming`). Per stuck order: offers made/open, nearest online rider, riders within the base and widened radius, last zero-offer attempt, dispatch_state, live_offer {offer_id, rider_id, rider_name, attempt_no, seconds_left, eta_seconds}, cycle_no, attempts_made, start_at, expected_ready_at, needs_attention, attention_reason, and a reason (scheduled | waiting_for_rider_reply | no_online_riders | none_in_range | fee_exceeds_order_budget | all_declined_or_expired | needs_attention). service_role only.';
comment on function admin_reassign_order_rider(uuid, uuid, text, uuid) is
  'Admin dispatch override for an order that has not been picked up (accepted, preparing, ready_for_pickup, rider_assigned). p_rider_id null: unassign the current rider (their accepted offer becomes revoked, so they are never re-offered; fee, location and notification handled) and offer the order afresh through the engine (trigger admin_reoffer) - from rider_assigned the status returns to ready_for_pickup and the 30 minute give-up window restarts. p_rider_id set: force that rider onto the order (KYC-approved, active, online, recent location, no other active order, fee fundable); the live offer becomes superseded (admin_assigned) and ONE new accepted offer row is inserted (this cycle, next attempt). Locks orders -> riders -> order_dispatch like a rider''s accept. Reason required; one admin_audit_log row and one order_events row; no ledger writes. Idempotent: assigning the current rider, or re-offering an order already on offer, is a no-op with no audit row. service_role only.';
comment on function vendor_dispatch_state(uuid) is
  'For vendor staff of the order''s vendor: {state: offers_pending | no_rider_nearby | rider_assigned | self_delivery | not_applicable, can_expand, expand_available_in_seconds (null = now or never), riders_in_range, radius_m, base_radius_m, store_radius_m, expansions_used, dispatch_state (scheduled | searching | offered | assigned | needs_attention | stopped), expected_ready_at, start_at (when dispatch begins), searching_since, attempts_made, assigned_eta_at}. authenticated only.';
