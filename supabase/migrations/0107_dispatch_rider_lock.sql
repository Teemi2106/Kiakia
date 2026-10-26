-- 0107: a rider is asked about ONE order at a time, under concurrency (D1/D2).
--
-- Found by the concurrency harness (scenario 8.1): two ticks on two orders, one shared
-- nearest rider, both read only COMMITTED offers, so both inserted a live offer for the
-- rider (27 of 40 runs). No double assignment resulted (accept refuses "already has an
-- active order") but D1 was broken and the order holding the dead offer waited up to 45 s.
--
-- 1. _dispatch_advance locks the chosen candidate's riders row (FOR UPDATE SKIP LOCKED) and
--    re-checks _dispatch_rider_excluded / _dispatch_rider_available UNDER the lock before
--    inserting; a locked or failing candidate is skipped and the next one (up to 5 per ring
--    stage) is tried. The lock is held to commit, so a second tick that runs afterwards sees
--    the committed offer (excluded), and one that runs meanwhile skips the locked rider.
--    Also fixed: closed orders are checked before the rider branch (a cancelled order that
--    held a rider is 'stopped', not 'assigned').
--
-- 2. Wake-up: when a rider is assigned (orders.rider_id set: accept, admin assign, any
--    path) or goes offline, every OTHER order where that rider holds a live offer gets
--    order_dispatch.next_check_at = now(), so the next tick cancels the dead offer
--    ('rider_unavailable') and offers the next rider at once. Implemented as triggers
--    (no signature change to set_rider_online / accept / admin RPCs).
--
-- LOCK ORDER (global): orders -> riders -> order_dispatch (other orders, in order_id order).
--   * tick/advance : orders(O) -> order_dispatch(O) -> riders(candidate) SKIP LOCKED.
--     Never WAITS for a rider, so it cannot be one side of a cycle through a rider lock.
--   * accept / admin reassign : orders(O) -> riders(R) -> ... -> (trigger) order_dispatch
--     of R's other offered orders. Those od rows are held by a tick only together with that
--     tick's own orders row, and a tick waits for nothing an accept holds (the rider is
--     skipped, not awaited), so the wait chain ends.
--   * set_rider_online(false) : riders(R) -> (trigger) order_dispatch rows. Same argument:
--     the tick that holds such a row skip-locks R rather than waiting for it.
--   * update_rider_location : riders row only, takes nothing afterwards.
--   * The wake-up deliberately does NOT lock the other ORDER (orders row) nor advance it
--     inline: that would be orders(O1) -> orders(O2) against a symmetric accept
--     orders(O2) -> orders(O1), a real deadlock. It only touches order_dispatch.next_check_at,
--     rows locked in order_id order so two wake-ups cannot cross each other.

create or replace function public._dispatch_advance(p_order_id uuid, p_trigger text, p_force_widen boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_found        boolean;
  v_seen         boolean;
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
    -- 0107: a closed order is 'order_closed' (state 'stopped') even if it kept its rider.
    when v_order.status in ('rejected_by_vendor', 'cancelled_by_customer', 'cancelled_by_platform', 'failed_delivery', 'delivered') then 'order_closed'
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
    v_found := false;
    v_seen := false;
    if v_cycle_offers < v_max_riders then
      v_ring := least(coalesce(v_od.ring, v_initial), v_max_ring);
      v_ring0 := v_ring;
      v_stage := 'rings';
      loop
        v_n := 0;
        for c in select * from _dispatch_candidates(p_order_id, v_ring, v_radius, v_od.cycle_no, 5) loop
          v_n := v_n + 1;
          v_seen := true;
          -- 0107 rider lock (lock order orders -> riders). SKIP LOCKED: a rider being
          -- offered/accepted/assigned by another transaction is skipped, never waited for.
          perform 1 from riders where user_id = c.rider_id for update skip locked;
          if found
             and not _dispatch_rider_excluded(p_order_id, c.rider_id, v_od.cycle_no)
             and _dispatch_rider_available(c.rider_id) then
            v_best := c;
            v_found := true;
            exit;
          end if;
        end loop;
        exit when v_found or v_ring >= v_max_ring;
        v_ring := v_ring + 1;
      end loop;
      if not v_found then
        v_stage := 'beyond_rings';
        v_n := 0;
        for c in select * from _dispatch_candidates(p_order_id, null, v_radius, v_od.cycle_no, 5) loop
          v_n := v_n + 1;
          v_seen := true;
          perform 1 from riders where user_id = c.rider_id for update skip locked;
          if found
             and not _dispatch_rider_excluded(p_order_id, c.rider_id, v_od.cycle_no)
             and _dispatch_rider_available(c.rider_id) then
            v_best := c;
            v_found := true;
            exit;
          end if;
        end loop;
      end if;
      if v_ring > v_ring0 then
        perform _dispatch_log(p_order_id, 'ring_expanded', jsonb_build_object('from', v_ring0, 'to', v_ring));
      end if;
    end if;

    exit when v_found;
    -- Candidates existed but were all locked/taken this instant: do not burn the cycle, retry shortly.
    exit when v_seen;
    -- Nothing left this cycle. Restart only if riders were actually asked in it
    -- (otherwise a restart changes nothing), and only once per call.
    exit when v_renewed or v_cycle_offers = 0;
    v_renew := true;
    v_renewed := true;
  end loop;

  -- 5a. Offer the best candidate.
  if v_found then
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
$function$;

create or replace function _dispatch_wake_rider_offers(p_rider_id uuid, p_except_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- lock first, in order_id order (see lock-order note in the migration header)
  perform 1 from order_dispatch od
  where od.order_id in (select d.order_id from dispatch_offers d
                        where d.rider_id = p_rider_id and d.status = 'offered' and d.order_id <> p_except_order)
    and od.state not in ('assigned', 'stopped')
  order by od.order_id
  for update;

  update order_dispatch od
  set next_check_at = now()
  where od.order_id in (select d.order_id from dispatch_offers d
                        where d.rider_id = p_rider_id and d.status = 'offered' and d.order_id <> p_except_order)
    and od.state not in ('assigned', 'stopped');
end;
$$;
revoke all on function _dispatch_wake_rider_offers(uuid, uuid) from public, anon, authenticated;

comment on function _dispatch_wake_rider_offers(uuid, uuid) is
  '0107: makes the next tick re-examine every other order where the rider holds a live offer (next_check_at = now()), so a dead offer is cancelled at once. Touches order_dispatch only, never the orders row (deadlock-safe).';

create or replace function _dispatch_sync_rider()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rider_id is not null then
    insert into order_dispatch (order_id, state, assigned_at)
    values (new.id, 'assigned', now())
    on conflict (order_id) do update
      set state = 'assigned', assigned_at = now(), next_check_at = null,
          needs_attention_since = null, attention_reason = null;
    perform _dispatch_wake_rider_offers(new.rider_id, new.id);   -- 0107
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

create or replace function _dispatch_rider_offline_wake()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _dispatch_wake_rider_offers(new.user_id, '00000000-0000-0000-0000-000000000000'::uuid);
  return new;
end;
$$;
revoke all on function _dispatch_rider_offline_wake() from public, anon, authenticated;

drop trigger if exists riders_dispatch_offline_wake on riders;
create trigger riders_dispatch_offline_wake
  after update of is_online on riders
  for each row
  when (old.is_online and not new.is_online)
  execute function _dispatch_rider_offline_wake();
