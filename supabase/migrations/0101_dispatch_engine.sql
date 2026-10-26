-- 0101: the sequential dispatch engine (docs/dispatch-design.md D1, D6, D7).
--
-- ONE function, _dispatch_advance(), closes a stale offer and issues the next
-- one. Every entry point (ready trigger, sweep, early dispatch, admin/vendor
-- re-dispatch) goes through it; the old simultaneous-round functions keep their
-- names and shapes as thin wrappers. Candidate discovery is H3 (0099) plus the
-- precise filters, ranked by estimated travel time.
--
-- Order of the file: ETA + start time, candidate discovery, engine, order
-- lifecycle triggers, rewired entry points. 0100's temporary patch of
-- _dispatch_offer_round is replaced here (accept / decline / admin RPCs are
-- 0102, the tick / cron / outbox are 0103, history-calibrated ETA and start
-- time are 0104).
--
-- Lock order everywhere: orders -> riders -> order_dispatch -> dispatch_offers.
-- Every function below that takes a lock takes it in that order; the engine
-- itself never locks riders (accept does, before it touches the order).

-- ===========================================================================
-- 1. Travel time and dispatch start (the seams later migrations refine)
-- ===========================================================================

-- D7: THE one place a rider's pickup time is estimated. Straight line x road
-- factor / default speed + a fixed 60 s overhead. 0104 calibrates the speed per
-- service area from history; callers and the signature stay as they are.
create or replace function _estimate_travel_seconds(p_from geography, p_to geography, p_service_area_id uuid)
returns integer
language sql stable security definer set search_path to 'public' as $$
  select case when p_from is null or p_to is null then null
    else (round(st_distance(p_from, p_to)
                * _platform_setting_int('dispatch_road_factor_pct') / 100.0
                / (_platform_setting_int('dispatch_default_speed_kmh') * 1000.0 / 3600.0)) + 60)::integer
  end
$$;

-- D8: when to start looking for a rider for a not-yet-ready order. Simple form:
-- expected ready - default travel - secure buffer, never before the vendor
-- accepted. 0104 replaces the two constants with the live best-candidate ETA
-- and the history-based buffer; keep this ONE function and its signature.
create or replace function _dispatch_start_at(p_order orders, p_expected_ready_at timestamptz default null)
returns timestamptz
language sql stable security definer set search_path to 'public' as $$
  select greatest(
    coalesce(p_expected_ready_at,
             (select od.expected_ready_at from order_dispatch od where od.order_id = p_order.id),
             coalesce(p_order.accepted_at, p_order.created_at) + make_interval(mins => v.avg_prep_mins))
      - make_interval(secs => _platform_setting_int('dispatch_default_travel_seconds')
                              + _platform_setting_int('dispatch_secure_buffer_seconds')),
    coalesce(p_order.accepted_at, p_order.created_at))
  from vendors v where v.id = p_order.vendor_id
$$;

-- ===========================================================================
-- 2. Candidate discovery
-- ===========================================================================

-- A rider who can be asked at all right now (order-independent): online, KYC
-- approved, active profile, fresh location, no active order. Used for the held
-- offer's re-check and by discovery.
create or replace function _dispatch_rider_available(p_rider_id uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select r.is_online
       and r.kyc_status = 'approved'
       and r.current_location is not null
       and r.last_ping_at >= now() - make_interval(secs => _platform_setting_int('dispatch_location_max_age_seconds')::integer)
       and p.status = 'active'
       and not exists (
         select 1 from orders o
         where o.rider_id = r.user_id
           and o.status in ('accepted', 'preparing', 'rider_assigned', 'picked_up', 'in_transit', 'arrived'))
    from riders r join profiles p on p.id = r.user_id
    where r.user_id = p_rider_id), false)
$$;

-- Order-specific exclusions: declined / revoked / accepted this order, already
-- asked in this cycle (any outcome), or holding a live unexpired offer for
-- ANOTHER order (a rider is asked about one order at a time).
create or replace function _dispatch_rider_excluded(p_order_id uuid, p_rider_id uuid, p_cycle_no integer)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from dispatch_offers d
    where d.rider_id = p_rider_id
      and ((d.order_id = p_order_id
            and (d.status in ('declined', 'revoked', 'accepted', 'offered') or d.cycle_no = p_cycle_no))
        or (d.order_id <> p_order_id and d.status = 'offered' and d.expires_at > now())))
$$;

-- D6. p_ring not null: riders in the H3 disk of k = p_ring around the vendor's
-- cell (stage 'rings'; ring = the rider's own k). p_ring null: PostGIS KNN
-- (stage 'beyond_rings'), the fallback after the last ring so no rider the old
-- system found is lost. p_radius_m null = no distance cap. Ranked by
-- eta_seconds then distance; at most p_limit rows.
--
-- ONE h3_grid_disk_distances call (k=8 costs ~6 ms, never loop per ring), each
-- disk cell mapped to its res-9 descendant range and joined to riders on
-- h3_cell between lo and hi so riders_h3_cell_idx serves every resolution.
create or replace function _dispatch_candidates(
  p_order_id uuid, p_ring integer, p_radius_m integer, p_cycle_no integer, p_limit integer default 1)
returns table (rider_id uuid, ring integer, distance_m integer, eta_seconds integer, fee_kobo bigint, stage text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_vloc    geography(point, 4326);
  v_dist    integer;
  v_area_id uuid;
  v_base    bigint;
  v_per_km  bigint;
  v_max_fee bigint;
  v_cell    bigint;
  v_limit   integer := greatest(coalesce(p_limit, 1), 1);
begin
  select v.location, coalesce(o.distance_m, 0), o.service_area_id
    into v_vloc, v_dist, v_area_id
  from orders o join vendors v on v.id = o.vendor_id
  where o.id = p_order_id;
  if v_vloc is null or v_area_id is null then
    return;
  end if;
  select sa.rider_base_fee_kobo, sa.rider_per_km_fee_kobo into v_base, v_per_km
  from service_areas sa where sa.id = v_area_id;
  if v_base is null then
    return;
  end if;
  v_max_fee := _max_rider_fee_kobo(p_order_id);
  if p_ring is not null then
    v_cell := h3_latlng_to_cell(st_y(v_vloc::geometry), st_x(v_vloc::geometry),
                                _platform_setting_int('dispatch_h3_resolution')::integer);
  end if;

  return query
  with disk as materialized (
    select d.cell, d.k from h3_grid_disk_distances(v_cell, p_ring) d      -- strict: no rows when either is null
  ), ranges as materialized (
    select d.k, g.lo, g.hi from disk d cross join lateral h3_cell_to_descendant_range(d.cell, 9) g
  ), pool as (
    select r.user_id as uid, rg.k, st_distance(r.current_location, v_vloc) as d, r.current_location as loc, 'rings'::text as stage
    from ranges rg
    join riders r on r.h3_cell between rg.lo and rg.hi
    where r.is_online
      and (p_radius_m is null or st_dwithin(r.current_location, v_vloc, p_radius_m))
      and v_base + v_per_km * ceil((st_distance(r.current_location, v_vloc) + v_dist) / 1000.0)::bigint <= v_max_fee
      and _dispatch_rider_available(r.user_id)
      and not _dispatch_rider_excluded(p_order_id, r.user_id, p_cycle_no)
    union all
    (select r.user_id, null::integer, st_distance(r.current_location, v_vloc), r.current_location, 'beyond_rings'::text
     from riders r
     where p_ring is null
       and r.is_online and r.current_location is not null
       and (p_radius_m is null or st_dwithin(r.current_location, v_vloc, p_radius_m))
       and v_base + v_per_km * ceil((st_distance(r.current_location, v_vloc) + v_dist) / 1000.0)::bigint <= v_max_fee
       and _dispatch_rider_available(r.user_id)
       and not _dispatch_rider_excluded(p_order_id, r.user_id, p_cycle_no)
     order by r.current_location <-> v_vloc
     limit v_limit)
  )
  select p.uid, p.k, round(p.d)::integer, e.eta,
         v_base + v_per_km * ceil((p.d + v_dist) / 1000.0)::bigint, p.stage
  from pool p
  cross join lateral (select _estimate_travel_seconds(p.loc, v_vloc, v_area_id) as eta) e
  order by e.eta, p.d, p.uid
  limit v_limit;
end;
$$;

-- ===========================================================================
-- 3. The engine
-- ===========================================================================

-- Closes the order's live offer (at most one exists) and logs it. One place for
-- every "this offer ends now" decision: expired, cancelled, superseded.
create or replace function _dispatch_close_live_offer(p_order_id uuid, p_status text, p_reason text)
returns integer
language plpgsql security definer set search_path to 'public' as $$
declare
  v_n integer := 0;
  v   record;
begin
  for v in
    update dispatch_offers set status = p_status, close_reason = p_reason
    where order_id = p_order_id and status = 'offered'
    returning id, rider_id
  loop
    v_n := v_n + 1;
    perform _dispatch_log(p_order_id, 'offer_' || p_status, jsonb_build_object('reason', p_reason), v.id, v.rider_id);
  end loop;
  return v_n;
end;
$$;

-- D1. Caller-visible outcome: offered | waiting | no_candidates | not_dispatchable.
-- Safe to call repeatedly and concurrently (it locks the order; the partial
-- unique indexes on dispatch_offers are the backstop).
create or replace function _dispatch_advance(p_order_id uuid, p_trigger text, p_force_widen boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_order        orders;
  v_od           order_dispatch;
  v_prep         integer;
  v_live         dispatch_offers;
  v_offer        dispatch_offers;
  v_reason       text;
  v_expired      integer := 0;
  v_initial      integer := _platform_setting_int('dispatch_h3_initial_ring')::integer;
  v_max_ring     integer := _platform_setting_int('dispatch_h3_max_ring')::integer;
  v_max_riders   integer := _platform_setting_int('dispatch_max_riders')::integer;
  v_cfg_radius   integer := _platform_setting_int('dispatch_radius_m')::integer;
  v_widen_after  integer := _platform_setting_int('dispatch_widen_after_seconds')::integer;
  v_notify_after integer := _platform_setting_int('dispatch_notify_vendor_after_seconds')::integer;
  v_wait_start   timestamptz;
  v_radius       integer;                 -- null = no cap
  v_store_radius integer;
  v_tier         text := 'base';
  v_ring         integer;
  v_ring0        integer;
  v_stage        text := 'rings';
  v_cycle_offers integer;
  v_n            integer := 0;
  v_renew        boolean;
  v_renewed      boolean;
  v_best         record;
  c              record;
  v_attn         text;
  v_rows         integer;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_dispatchable', 'reason', 'order_not_found');
  end if;
  select avg_prep_mins into v_prep from vendors where id = v_order.vendor_id;

  -- Recovery: make sure the state row exists. Cycle/attempt continue from any
  -- offers already issued (backfilled orders, admin-inserted rows).
  insert into order_dispatch (order_id, state, cycle_no, attempt_no, expected_ready_at, start_at)
  select v_order.id,
         case when v_order.status = 'ready_for_pickup' then 'searching' else 'scheduled' end,
         coalesce(max(d.cycle_no), 0), coalesce(max(d.attempt_no), 0),
         coalesce(v_order.accepted_at, v_order.created_at) + make_interval(mins => coalesce(v_prep, 0)),
         _dispatch_start_at(v_order)
  from dispatch_offers d where d.order_id = v_order.id
  on conflict (order_id) do nothing;
  select * into v_od from order_dispatch where order_id = p_order_id for update;

  -- 1. Still dispatchable?
  v_reason := case
    when v_order.delivery_by <> 'rider' then 'vendor_delivery'
    when v_order.rider_id is not null then 'assigned'
    when v_order.status in ('draft', 'placed') then 'not_accepted'
    when v_order.status not in ('accepted', 'preparing', 'ready_for_pickup') then 'order_closed'
    when v_order.payment_status <> 'paid' then 'unpaid'
    when v_order.status <> 'ready_for_pickup' and now() < coalesce(v_od.start_at, now()) then 'not_due'
  end;
  if v_reason is not null then
    perform _dispatch_close_live_offer(
      p_order_id,
      case when v_reason = 'assigned' then 'superseded' else 'cancelled' end,
      case v_reason
        when 'assigned' then 'order_assigned'
        when 'vendor_delivery' then 'vendor_self_delivery'
        when 'order_closed' then case when v_order.status in ('rejected_by_vendor', 'cancelled_by_customer', 'cancelled_by_platform')
                                      then 'order_cancelled' else 'order_closed' end
        else v_reason end);
    update order_dispatch
    set state = case v_reason when 'assigned' then 'assigned' when 'unpaid' then 'scheduled' when 'not_due' then 'scheduled' else 'stopped' end,
        next_check_at = case v_reason when 'unpaid' then now() + interval '60 seconds' when 'not_due' then v_od.start_at end,
        assigned_at = case when v_reason = 'assigned' then coalesce(assigned_at, now()) else assigned_at end
    where order_id = p_order_id;
    return jsonb_build_object('outcome', 'not_dispatchable', 'reason', v_reason,
                              'cycle_no', v_od.cycle_no, 'attempt_no', v_od.attempt_no);
  end if;

  -- 2. The live offer: keep it, or close it and carry on to the next rider.
  select * into v_live from dispatch_offers where order_id = p_order_id and status = 'offered';
  if found then
    if v_live.expires_at <= now() then
      v_expired := _dispatch_close_live_offer(p_order_id, 'expired', 'timeout');
    elsif not _dispatch_rider_available(v_live.rider_id) then
      perform _dispatch_close_live_offer(p_order_id, 'cancelled', 'rider_unavailable');
    else
      update order_dispatch set state = 'offered', next_check_at = v_live.expires_at where order_id = p_order_id;
      return jsonb_build_object('outcome', 'waiting', 'offer_id', v_live.id, 'rider_id', v_live.rider_id,
                                'cycle_no', v_live.cycle_no, 'attempt_no', v_live.attempt_no, 'ring', v_live.ring,
                                'radius_m', v_live.radius_m, 'reason', 'live_offer', 'offers_expired', 0);
    end if;
  end if;

  -- 3. Radius in use: the configured cap (0 = none), or the store's own radius
  -- once the wait passes dispatch_widen_after_seconds or the caller forces it
  -- (0098 semantics; only meaningful when a cap is configured).
  v_wait_start := case when v_order.status = 'ready_for_pickup'
                       then _dispatch_wait_start(v_order, v_prep)
                       else coalesce(v_od.start_at, now()) end;
  v_radius := nullif(v_cfg_radius, 0);
  v_store_radius := _dispatch_store_radius_m(v_order.vendor_id);
  if v_cfg_radius > 0 and (coalesce(p_force_widen, false)
       or (v_widen_after > 0 and now() >= v_wait_start + make_interval(secs => v_widen_after))) then
    v_tier := 'widened';
    v_radius := v_store_radius;
  end if;

  -- 4. Find the next candidate: rings from the stored ring outwards, then the
  -- radius-capped fallback; when a cycle is used up, ONE fresh cycle.
  v_initial := least(v_initial, v_max_ring);
  -- A ready order starts a fresh cycle so riders asked during early dispatch
  -- are eligible again (the 0098 ready-trigger behaviour).
  v_renew := p_trigger = 'ready' and v_od.cycle_no > 0
             and exists (select 1 from dispatch_offers where order_id = p_order_id and cycle_no = v_od.cycle_no);
  v_renewed := v_renew;
  loop
    if v_od.cycle_no = 0 or v_renew then
      update order_dispatch set cycle_no = cycle_no + 1, ring = v_initial where order_id = p_order_id returning * into v_od;
      if v_od.cycle_no > 1 or v_order.dispatch_cycle_started_at is null then
        update orders set dispatch_cycle_started_at = now() where id = p_order_id;
      end if;
      perform _dispatch_log(p_order_id, 'cycle_started', jsonb_build_object('trigger', p_trigger, 'ring', v_initial));
      if v_od.cycle_no >= 3 and v_od.needs_attention_since is null then
        update order_dispatch set needs_attention_since = now(), attention_reason = 'two_cycles_without_accept'
        where order_id = p_order_id returning * into v_od;
        perform _dispatch_log(p_order_id, 'needs_attention', jsonb_build_object('reason', 'two_cycles_without_accept'));
      end if;
      v_renew := false;
    end if;

    select count(*)::integer into v_cycle_offers
    from dispatch_offers where order_id = p_order_id and cycle_no = v_od.cycle_no;

    v_n := 0;
    if v_cycle_offers < v_max_riders then
      v_ring := least(coalesce(v_od.ring, v_initial), v_max_ring);
      v_ring0 := v_ring;
      loop
        v_n := 0;
        for c in select * from _dispatch_candidates(p_order_id, v_ring, v_radius, v_od.cycle_no, 3) loop
          v_n := v_n + 1;
          if v_n = 1 then v_best := c; end if;
        end loop;
        exit when v_n > 0 or v_ring >= v_max_ring;
        v_ring := v_ring + 1;
      end loop;
      v_stage := 'rings';
      if v_n = 0 then
        v_stage := 'beyond_rings';
        for c in select * from _dispatch_candidates(p_order_id, null, v_radius, v_od.cycle_no, 3) loop
          v_n := v_n + 1;
          if v_n = 1 then v_best := c; end if;
        end loop;
      end if;
      if v_ring > v_ring0 then
        perform _dispatch_log(p_order_id, 'ring_expanded', jsonb_build_object('from', v_ring0, 'to', v_ring));
      end if;
    end if;

    exit when v_n > 0;
    -- Nothing left this cycle. Restart only if riders were actually asked in it
    -- (otherwise a restart changes nothing), and only once per call.
    exit when v_renewed or v_cycle_offers = 0;
    v_renew := true;
    v_renewed := true;
  end loop;

  -- 5a. Offer the best candidate.
  if v_n > 0 then
    begin
      insert into dispatch_offers (order_id, rider_id, cycle_no, attempt_no, expires_at, ring, radius_m, distance_m, eta_seconds)
      values (p_order_id, v_best.rider_id, v_od.cycle_no,
              -- attempt_no is per order; an admin-inserted offer may be ahead of the stored counter
              greatest(v_od.attempt_no, coalesce((select max(attempt_no) from dispatch_offers where order_id = p_order_id), 0)) + 1,
              now() + _dispatch_offer_ttl(), v_best.ring, v_radius, v_best.distance_m, v_best.eta_seconds)
      returning * into v_offer;
    exception when unique_violation then
      -- Someone else issued the live offer first (unique indexes are the backstop).
      return jsonb_build_object('outcome', 'waiting', 'reason', 'concurrent_offer',
                                'cycle_no', v_od.cycle_no, 'attempt_no', v_od.attempt_no, 'offers_expired', v_expired);
    end;
    update order_dispatch
    set attempt_no = v_offer.attempt_no,
        ring = coalesce(v_best.ring, v_ring),
        state = 'offered',
        next_check_at = v_offer.expires_at,
        dispatch_started_at = coalesce(dispatch_started_at, now()),
        error_count = 0, last_error = null,
        needs_attention_since = case when attention_reason = 'no_candidates' then null else needs_attention_since end,
        attention_reason = case when attention_reason = 'no_candidates' then null else attention_reason end
    where order_id = p_order_id returning * into v_od;
    perform _dispatch_log(p_order_id, 'offer_created',
      jsonb_build_object('trigger', p_trigger, 'stage', v_stage, 'ring', v_offer.ring, 'tier', v_tier, 'radius_m', v_radius,
                         'distance_m', v_offer.distance_m, 'eta_seconds', v_offer.eta_seconds, 'candidates_evaluated', v_n),
      v_offer.id, v_offer.rider_id);
    return jsonb_build_object('outcome', 'offered', 'offer_id', v_offer.id, 'rider_id', v_offer.rider_id,
      'cycle_no', v_offer.cycle_no, 'attempt_no', v_offer.attempt_no, 'ring', v_offer.ring, 'stage', v_stage,
      'radius_m', v_radius, 'tier', v_tier, 'candidates_evaluated', v_n, 'reason', null, 'offers_expired', v_expired);
  end if;

  -- 5b. Nobody to ask. Record the funnel (0098 upsert + throttle), tell the
  -- vendor (C8), flag for operations when due, and look again shortly.
  select * into c from _dispatch_rider_counts(p_order_id, v_radius);
  insert into dispatch_attempts (order_id, tier, radius_m, online_riders, eligible_riders, riders_in_range, riders_fundable, offers_created)
  values (p_order_id, v_tier, v_radius, c.online_riders, c.eligible_riders, c.in_range_riders, c.fundable_riders, 0)
  on conflict (order_id, tier) do update
    set attempted_at    = now(),
        attempts        = dispatch_attempts.attempts + 1,
        radius_m        = excluded.radius_m,
        online_riders   = excluded.online_riders,
        eligible_riders = excluded.eligible_riders,
        riders_in_range = excluded.riders_in_range,
        riders_fundable = excluded.riders_fundable,
        offers_created  = 0
    where dispatch_attempts.attempted_at < now() - interval '60 seconds'
       or (dispatch_attempts.radius_m, dispatch_attempts.online_riders, dispatch_attempts.eligible_riders,
           dispatch_attempts.riders_in_range, dispatch_attempts.riders_fundable)
          is distinct from
          (excluded.radius_m, excluded.online_riders, excluded.eligible_riders,
           excluded.riders_in_range, excluded.riders_fundable);
  get diagnostics v_rows = row_count;
  if v_rows > 0 then   -- same throttle as the funnel row: no event per 15 s retry
    perform _dispatch_log(p_order_id, 'no_candidates', jsonb_build_object(
      'trigger', p_trigger, 'tier', v_tier, 'radius_m', v_radius, 'ring', v_ring, 'online', c.online_riders,
      'eligible', c.eligible_riders, 'in_range', c.in_range_riders, 'fundable', c.fundable_riders));
  end if;

  if v_notify_after > 0
     and c.in_range_riders = 0
     and now() >= v_wait_start + make_interval(secs => v_notify_after) then
    insert into notifications (vendor_id, order_id, kind, title, body)
    values (
      v_order.vendor_id, p_order_id, 'no_rider_nearby', 'No rider nearby',
      case
        when v_cfg_radius > 0 and v_store_radius > coalesce(v_radius, 0)
          then format('No rider is near you right now for order %s. You can look for riders up to %s km away, or deliver it yourself.',
                      v_order.code, regexp_replace(round(v_store_radius / 1000.0, 1)::text, '\.0$', ''))
        else format('No rider is near you right now for order %s. You can wait for one, or deliver it yourself.', v_order.code)
      end)
    on conflict (order_id, kind) where kind is not null do nothing;
  end if;

  v_attn := case
    when v_notify_after > 0 and now() >= v_wait_start + make_interval(secs => v_notify_after) then 'no_candidates'
    when v_od.cycle_no >= 3 then 'two_cycles_without_accept'
  end;
  update order_dispatch
  set state = case when v_attn is not null then 'needs_attention' else 'searching' end,
      needs_attention_since = case when v_attn is not null then coalesce(needs_attention_since, now()) else needs_attention_since end,
      attention_reason = case when v_attn is not null then coalesce(attention_reason, v_attn) else attention_reason end,
      ring = coalesce(v_ring, ring),
      next_check_at = now() + interval '15 seconds',
      dispatch_started_at = coalesce(dispatch_started_at, now()),
      error_count = 0, last_error = null
  where order_id = p_order_id;
  if v_attn is not null and v_od.needs_attention_since is null then
    perform _dispatch_log(p_order_id, 'needs_attention', jsonb_build_object('reason', v_attn));
  end if;

  return jsonb_build_object('outcome', 'no_candidates', 'offer_id', null, 'rider_id', null,
    'cycle_no', v_od.cycle_no, 'attempt_no', v_od.attempt_no, 'ring', v_ring, 'stage', 'beyond_rings',
    'radius_m', v_radius, 'tier', v_tier, 'candidates_evaluated', 0, 'in_range_riders', c.in_range_riders,
    'reason', 'none_available', 'offers_expired', v_expired);
end;
$$;

-- ===========================================================================
-- 4. Order lifecycle hooks (AFTER UPDATE triggers on orders)
-- ===========================================================================
-- Fire order is alphabetical by trigger name. These two sort before
-- orders_dispatch_to_riders (the ready trigger) and after
-- orders_clear_rider_location_on_terminal; none of them touches the columns the
-- others read, and none changes dispatch_offers except the terminal close below
-- (cancelled; accepted offers are never touched here).

-- Vendor accepted: schedule dispatch. Terminal status: stop and cancel the live offer.
create or replace function _dispatch_sync_status()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_ready timestamptz;
  v_start timestamptz;
begin
  if new.status = 'accepted' then
    if new.delivery_by = 'rider' then
      select coalesce(new.accepted_at, now()) + make_interval(mins => v.avg_prep_mins) into v_ready
      from vendors v where v.id = new.vendor_id;
      v_start := _dispatch_start_at(new, v_ready);
      insert into order_dispatch (order_id, state, expected_ready_at, start_at, next_check_at)
      values (new.id, case when new.rider_id is null then 'scheduled' else 'assigned' end, v_ready, v_start,
              case when new.rider_id is null then v_start end)
      on conflict (order_id) do update
        set state = excluded.state, expected_ready_at = excluded.expected_ready_at,
            start_at = excluded.start_at, next_check_at = excluded.next_check_at;
      perform _dispatch_log(new.id, 'scheduled', jsonb_build_object('expected_ready_at', v_ready, 'start_at', v_start));
    end if;
  else
    perform _dispatch_close_live_offer(new.id, 'cancelled',
      case when new.status in ('delivered', 'failed_delivery') then 'order_closed' else 'order_cancelled' end);
    update order_dispatch set state = 'stopped', next_check_at = null
    where order_id = new.id and state <> 'stopped';
  end if;
  return new;
end;
$$;

-- A rider was set: dispatch is done. A rider was removed from an order that is
-- still waiting: dispatch resumes (the sweep picks it up straight away).
-- Deliberately does NOT touch dispatch_offers: accept sets rider_id before it
-- marks its own offer accepted, and the engine supersedes strays itself.
create or replace function _dispatch_sync_rider()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.rider_id is not null then
    insert into order_dispatch (order_id, state, assigned_at)
    values (new.id, 'assigned', now())
    on conflict (order_id) do update
      set state = 'assigned', assigned_at = now(), next_check_at = null,
          needs_attention_since = null, attention_reason = null;
  elsif new.delivery_by = 'rider' and new.status in ('accepted', 'preparing', 'ready_for_pickup') then
    update order_dispatch
    set state = case when new.status = 'ready_for_pickup' then 'searching' else 'scheduled' end,
        assigned_at = null,
        next_check_at = case when new.status = 'ready_for_pickup' then now() else coalesce(start_at, now()) end
    where order_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_dispatch_sync_status on orders;
create trigger orders_dispatch_sync_status
  after update of status on orders
  for each row
  when (old.status is distinct from new.status
        and new.status in ('accepted', 'rejected_by_vendor', 'cancelled_by_customer', 'cancelled_by_platform',
                           'failed_delivery', 'delivered'))
  execute function _dispatch_sync_status();

drop trigger if exists orders_dispatch_sync_rider on orders;
create trigger orders_dispatch_sync_rider
  after update of rider_id on orders
  for each row
  when (old.rider_id is distinct from new.rider_id)
  execute function _dispatch_sync_rider();

-- ===========================================================================
-- 5. Entry points (names, signatures and return types unchanged)
-- ===========================================================================

-- Ready trigger. The 0064 early-accept cascade is untouched.
create or replace function dispatch_order_to_nearby_riders()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  -- 0098: the vendor is delivering this order themselves; nothing to dispatch.
  if new.delivery_by = 'vendor' then
    return new;
  end if;

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
  -- 30 minute give-up window while the kitchen was still cooking.
  update orders
  set first_dispatched_at = now(),
      dispatch_cycle_started_at = now()
  where id = new.id;

  begin
    perform _dispatch_advance(new.id, 'ready');
  exception when others then
    -- Never abort the vendor's ready_for_pickup transition; the sweep retries.
    raise warning 'dispatch_order_to_nearby_riders: failed to create dispatch offers for order % - %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- Wrappers over the engine. p_cycle_started_at and p_batch_size are accepted
-- for compatibility and ignored: cycles are numbered in order_dispatch and
-- there is no batch any more (one offer at a time).
create or replace function _dispatch_offer_round(
  p_order_id uuid, p_cycle_started_at timestamptz, p_batch_size integer default null, p_widen text default 'auto')
returns table (o_offers integer, o_in_range integer, o_radius_m integer, o_tier text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v jsonb;
begin
  if p_widen not in ('auto', 'force', 'never') then
    raise exception '_dispatch_offer_round: unknown widen mode %', p_widen;
  end if;
  v := _dispatch_advance(p_order_id, 'offer_round', p_widen = 'force');
  return query select (v ->> 'outcome' = 'offered')::integer, (v ->> 'in_range_riders')::integer,
                      (v ->> 'radius_m')::integer, coalesce(v ->> 'tier', 'base');
end;
$$;

create or replace function _dispatch_offer_batch(p_order_id uuid, p_cycle_started_at timestamptz, p_batch_size integer default null)
returns integer
language plpgsql security definer set search_path to 'public' as $$
begin
  return case when _dispatch_advance(p_order_id, 'offer_batch') ->> 'outcome' = 'offered' then 1 else 0 end;
end;
$$;

-- Admin re-dispatch / vendor "look further away". Never double-offers: with a
-- live offer the engine answers 'waiting' and offers_created is 0.
-- (0102: pass 'admin_redispatch' / 'vendor_expand' as the trigger once the
-- callers can say which they are; the signature cannot grow without a new overload.)
create or replace function _redispatch_core(p_order_id uuid, p_widen boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v jsonb;
begin
  -- Anchor for the 30 minute give-up, same as the sweep.
  update orders set first_dispatched_at = now()
  where id = p_order_id and status = 'ready_for_pickup' and first_dispatched_at is null;

  v := _dispatch_advance(p_order_id, 'redispatch', coalesce(p_widen, true));
  return jsonb_build_object(
    'offers_created', (v ->> 'outcome' = 'offered')::integer,
    'riders_in_range', (v ->> 'in_range_riders')::integer,
    'radius_m', (v ->> 'radius_m')::integer,
    'tier', coalesce(v ->> 'tier', 'base'));
end;
$$;

-- Every 15 s (pg_cron, service role): advance each order whose check is due,
-- whose live offer lapsed, or that is dispatchable with no state row.
create or replace function sweep_dispatch_offers()
returns table (offers_expired integer, offers_created integer, orders_cancelled integer)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
  v_expired     integer := 0;
  v_created     integer := 0;
  v_cancelled   integer := 0;
  v_id          uuid;
  v_order       orders;
  v_res         jsonb;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'sweep_dispatch_offers: requires the service-role key';
  end if;

  for v_id in
    select x.order_id
    from (
      select od.order_id, od.next_check_at as due from order_dispatch od
      where od.state not in ('assigned', 'stopped') and (od.next_check_at is null or od.next_check_at <= now())
      union all
      select d.order_id, d.expires_at from dispatch_offers d where d.status = 'offered' and d.expires_at <= now()
      union all
      select o.id, o.created_at from orders o
      where o.status in ('accepted', 'preparing', 'ready_for_pickup') and o.rider_id is null and o.delivery_by = 'rider'
        and o.payment_status = 'paid' and not exists (select 1 from order_dispatch od where od.order_id = o.id)
    ) x
    group by x.order_id
    order by min(x.due) nulls first
    limit 100
  loop
    select * into v_order from orders where id = v_id for update skip locked;
    if not found then
      continue;
    end if;

    -- An order that reached ready_for_pickup before 0067 was never stamped;
    -- give it a real anchor so the give-up below can eventually fire.
    if v_order.status = 'ready_for_pickup' and v_order.first_dispatched_at is null then
      update orders set first_dispatched_at = now() where id = v_order.id;
      v_order.first_dispatched_at := now();
    end if;

    begin
      v_res := _dispatch_advance(v_id, 'sweep');
    exception when others then
      raise warning 'sweep_dispatch_offers: failed to advance order % - %', v_id, sqlerrm;
      v_res := jsonb_build_object('outcome', 'error');
      update order_dispatch
      set error_count = error_count + 1, last_error = left(sqlerrm, 500),
          next_check_at = now() + make_interval(secs => least(5 * power(2, least(error_count, 6)), 300))
      where order_id = v_id;
    end;

    v_expired := v_expired + coalesce((v_res ->> 'offers_expired')::integer, 0);
    if v_res ->> 'outcome' = 'offered' then
      v_created := v_created + 1;
    end if;

    -- Nobody to ask: give up once the order has waited 30 minutes (unchanged;
    -- a failing order must not be exempt either).
    if v_order.status = 'ready_for_pickup'
       and v_res ->> 'outcome' in ('no_candidates', 'error')
       and now() >= v_order.first_dispatched_at + interval '30 minutes' then
      begin
        perform transition_order(
          v_order.id, 'cancelled_by_platform', 'system', null,
          jsonb_build_object('reason', 'dispatch_exhausted_after_30_minutes')
        );
        v_cancelled := v_cancelled + 1;
      exception when others then
        raise warning 'sweep_dispatch_offers: failed to auto-cancel order % after 30 minutes with no rider - %', v_order.id, sqlerrm;
      end;
    end if;
  end loop;

  return query select v_expired, v_created, v_cancelled;
end;
$$;

-- Early dispatch: scheduled orders whose start time has passed (0103 folds this
-- into the tick).
create or replace function dispatch_orders_nearing_prep_completion()
returns table (offers_created integer)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_caller_role text := coalesce(auth.role(), current_setting('role', true));
  v_created     integer := 0;
  v_id          uuid;
  v_order       orders;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'dispatch_orders_nearing_prep_completion: requires the service-role key';
  end if;

  for v_id in
    select o.id
    from orders o join order_dispatch od on od.order_id = o.id
    where o.status in ('accepted', 'preparing') and o.rider_id is null and o.delivery_by = 'rider'
      and od.state = 'scheduled' and od.start_at <= now()
    order by od.start_at
    limit 100
  loop
    select * into v_order from orders where id = v_id for update skip locked;
    if not found then
      continue;
    end if;
    begin
      if _dispatch_advance(v_id, 'early_dispatch') ->> 'outcome' = 'offered' then
        v_created := v_created + 1;
      end if;
    exception when others then
      raise warning 'dispatch_orders_nearing_prep_completion: failed to create dispatch offers for order % - %', v_id, sqlerrm;
    end;
  end loop;

  return query select v_created;
end;
$$;

-- ===========================================================================
-- 6. Grants: internal helpers are callable by nobody but the definer functions
-- ===========================================================================
revoke all on function _estimate_travel_seconds(geography, geography, uuid) from public, anon, authenticated, service_role;
revoke all on function _dispatch_start_at(orders, timestamptz) from public, anon, authenticated, service_role;
revoke all on function _dispatch_rider_available(uuid) from public, anon, authenticated, service_role;
revoke all on function _dispatch_rider_excluded(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function _dispatch_candidates(uuid, integer, integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function _dispatch_close_live_offer(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function _dispatch_advance(uuid, text, boolean) from public, anon, authenticated, service_role;
revoke all on function _dispatch_sync_status() from public, anon, authenticated, service_role;
revoke all on function _dispatch_sync_rider() from public, anon, authenticated, service_role;

comment on function _dispatch_advance(uuid, text, boolean) is
  'The sequential dispatch engine (0101, design D1): validates the order, keeps or closes the live offer, issues at most one new offer (H3 rings, then radius-capped fallback, cycles), records the funnel / vendor notice / needs_attention. Returns jsonb {outcome: offered|waiting|no_candidates|not_dispatchable, ...}. Internal; it takes the order lock itself.';
comment on function _dispatch_candidates(uuid, integer, integer, integer, integer) is
  'H3 candidate discovery for one order (0101, D6): p_ring = disk radius in rings, null = PostGIS KNN fallback; precise filters + fee funding; ranked by ETA then distance. Internal.';
