-- 0109: fixes from the security review and production audit of the sequential dispatch.
--
--  1. _dispatch_sync_status (the vendor's Accept transaction): a failure in _dispatch_start_calc
--     (rings + KNN scan) is caught; start_at falls back to the 0101 formula and a
--     'start_calc_failed' event makes it visible. A vendor Accept never fails because of dispatch
--     estimation. (Errors are caught; a pathologically SLOW estimate is not interruptible from
--     inside a function, which is why 0108 made the scan millisecond-scale.)
--  2. _dispatch_advance: a distinct 'busy' outcome. Before, "candidates were returned but none
--     could be asked" (rider row locked by another transaction, or the under-lock re-check
--     failed) left the search loop, stored ring = max ring, and was handled like "no candidates":
--     the same top riders were retried every tick without expanding, and the funnel /
--     needs_attention fired as if nobody was nearby. Now:
--       * outcome 'busy', order_dispatch.busy_count + 1, retry in 5 s (one tick), event
--         'dispatch_busy' {busy_count, locked, rejected, ring, stage, limit}; NO funnel row, vendor
--         notice, needs_attention, ring or cycle change.
--       * after 3 consecutive busy results (v_busy_max, a constant: 3 ticks = 15 s covers any
--         transient row lock, which lasts milliseconds, so three in a row means a persistent
--         cause such as predicate drift) the next pass examines 25 candidates per step instead of 5,
--         skipping every unavailable rider, so riders beyond the unavailable top few are reached;
--         if it still finds nobody the normal fall-through applies (next cycle / no-candidates
--         path, which also keeps the 30-minute give-up reachable) and busy_count resets.
--  3. The legacy wrappers sweep_dispatch_offers() and dispatch_orders_nearing_prep_completion()
--     now process at most 10 orders per call (was 100; they run in ONE transaction, so every order
--     lock is held until the end). They exist for tests and manual use and must never be scheduled;
--     dispatch_tick() (the real worker, a procedure) commits after every order.
--  4. Hygiene: _dispatch_worker_caller_ok() gets a pinned search_path; execute revoked from anon on
--     accept_dispatch_offer, decline_dispatch_offer (rider RPCs, authenticated only; both start
--     with auth.uid() so anon never worked) and from public/anon/authenticated on the trigger
--     function dispatch_order_to_nearby_riders (creating a trigger needs EXECUTE at CREATE time,
--     firing does not).
--  5. Rate limit: DOCUMENTED as best-effort (comment on _dispatch_rate_check, design note). An
--     autonomous count would need dblink / an autonomous transaction, a larger change than this review.
--  6. admin_dispatch_health(): dead-tick / misconfiguration check for the admin page.
--  7. One-off: orders accepted before the deploy and swept into order_dispatch by the 0100 backfill
--     (state 'searching', no start_at) would be dispatched at once, ignoring the predictive start.
--     _dispatch_reschedule_unstarted() recomputes start_at for them and puts them back to
--     'scheduled'. Small, per-row exception guarded, run once below.
--
-- Deploy locks: ALTER TABLE ... ADD COLUMN with a constant default (metadata only, brief ACCESS
-- EXCLUSIVE on order_dispatch); the events check constraint is added NOT VALID then validated
-- (SHARE UPDATE EXCLUSIVE, writers keep working); everything else is CREATE OR REPLACE / grants.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table order_dispatch add column if not exists busy_count integer not null default 0;
comment on column order_dispatch.busy_count is
  '0109: consecutive _dispatch_advance runs that found candidates but could not ask any (rider locked / failed the under-lock re-check). Reset by an offer or a no-candidates result.';

alter table dispatch_events drop constraint dispatch_events_event_check;
alter table dispatch_events add constraint dispatch_events_event_check
  check (event in ('scheduled', 'start_recomputed', 'cycle_started', 'ring_expanded', 'offer_created', 'offer_accepted',
                   'offer_declined', 'offer_expired', 'offer_cancelled', 'offer_superseded', 'accept_conflict',
                   'stale_accept_rejected', 'no_candidates', 'needs_attention', 'tick_error', 'prep_estimate_changed',
                   'ready_early', 'prep_overrun', 'eta_increased', 'rider_at_vendor', 'push_failed', 'tick_lag',
                   'start_calc_failed', 'dispatch_busy')) not valid;
alter table dispatch_events validate constraint dispatch_events_event_check;

-- ---------------------------------------------------------------------------
-- 1. Vendor Accept never fails because of dispatch estimation
-- ---------------------------------------------------------------------------

create or replace function public._dispatch_sync_status()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ready timestamptz;
  v_start timestamptz;
  v_basis jsonb;
  v_travel integer;
  v_buf    integer;
  v_err    text;
  v_state  text;
begin
  if new.status = 'accepted' then
    if new.delivery_by = 'rider' then
      select coalesce(new.accepted_at, now()) + make_interval(mins => v.avg_prep_mins) into v_ready
      from vendors v where v.id = new.vendor_id;
      -- 0109: the estimate is best-effort. On ANY failure use the 0101 formula
      -- (expected ready - default travel - secure buffer, never before accepted_at).
      begin
        select c.start_at, c.basis into v_start, v_basis from _dispatch_start_calc(new, v_ready) c;
      exception when others then
        v_state := sqlstate;
        v_err := left(sqlerrm, 200);
        begin
          v_travel := _platform_setting_int('dispatch_default_travel_seconds')::integer;
          v_buf := least(900, greatest(45, _platform_setting_int('dispatch_secure_buffer_seconds')::integer));
        exception when others then
          v_travel := 600;
          v_buf := 150;
        end;
        v_start := greatest(v_ready - make_interval(secs => v_travel + v_buf), coalesce(new.accepted_at, now()));
        v_basis := jsonb_build_object('travel_s', v_travel, 'travel_source', 'default', 'buffer_s', v_buf,
                                      'buffer_source', 'default', 'candidates_used', 0, 'fallback', true,
                                      'expected_ready_at', v_ready, 'computed_at', now());
        begin
          perform _dispatch_log(new.id, 'start_calc_failed', jsonb_build_object('sqlstate', v_state, 'error', v_err));
        exception when others then
          raise warning '_dispatch_sync_status: could not log start_calc_failed for order %', new.id;
        end;
        raise warning '_dispatch_sync_status: start estimate failed for order %, used the default formula', new.id;
      end;
      insert into order_dispatch (order_id, state, expected_ready_at, start_at, start_basis, next_check_at)
      values (new.id, case when new.rider_id is null then 'scheduled' else 'assigned' end, v_ready, v_start, v_basis,
              case when new.rider_id is null then least(v_start, now() + interval '60 seconds') end)
      on conflict (order_id) do update
        set state = excluded.state, expected_ready_at = excluded.expected_ready_at, start_at = excluded.start_at,
            start_basis = excluded.start_basis, next_check_at = excluded.next_check_at;
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
$function$;

-- ---------------------------------------------------------------------------
-- 2. _dispatch_advance: 'busy' outcome (0108 body, diff-minimal; every change tagged 0109)
-- ---------------------------------------------------------------------------

create or replace function public._dispatch_advance(p_order_id uuid, p_trigger text, p_force_widen boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
  -- 0109: busy handling (candidates existed but none could be asked this instant)
  v_busy_max     constant integer := 3;
  v_limit        integer;
  v_busy         boolean := false;
  v_locked       integer := 0;
  v_rejected     integer := 0;
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
  -- 0109: after v_busy_max consecutive busy results, look at more candidates per step (25, not 5)
  -- so riders beyond the unavailable top few are reached.
  v_limit := case when coalesce(v_od.busy_count, 0) >= v_busy_max then 25 else 5 end;
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
        -- 0108: ONE scan returns the candidates of the first ring >= v_ring that
        -- has any survivor; empty rings are skipped inside it. scan_ring is the ring used.
        for c in select * from _dispatch_scan(p_order_id, v_ring, v_max_ring, v_radius, v_od.cycle_no, v_limit) loop
          v_ring := c.scan_ring;
          v_n := v_n + 1;
          v_seen := true;
          -- 0107 rider lock (lock order orders -> riders). SKIP LOCKED: a rider being
          -- offered/accepted/assigned by another transaction is skipped, never waited for.
          perform 1 from riders where user_id = c.rider_id for update skip locked;
          if not found then
            v_locked := v_locked + 1;           -- 0109: held by another transaction right now
          elsif not _dispatch_rider_excluded(p_order_id, c.rider_id, v_od.cycle_no)
                and _dispatch_rider_available(c.rider_id) then
            v_best := c;
            v_found := true;
            exit;
          else
            v_rejected := v_rejected + 1;       -- 0109: failed the under-lock re-check
          end if;
        end loop;
        -- nothing in any remaining ring: same end state as stepping ring by ring to the max
        if v_n = 0 then
          v_ring := v_max_ring;
        end if;
        exit when v_found or v_ring >= v_max_ring;
        v_ring := v_ring + 1;
      end loop;
      if not v_found then
        v_stage := 'beyond_rings';
        v_n := 0;
        for c in select * from _dispatch_candidates(p_order_id, null, v_radius, v_od.cycle_no, v_limit) loop
          v_n := v_n + 1;
          v_seen := true;
          perform 1 from riders where user_id = c.rider_id for update skip locked;
          if not found then
            v_locked := v_locked + 1;           -- 0109: held by another transaction right now
          elsif not _dispatch_rider_excluded(p_order_id, c.rider_id, v_od.cycle_no)
                and _dispatch_rider_available(c.rider_id) then
            v_best := c;
            v_found := true;
            exit;
          else
            v_rejected := v_rejected + 1;       -- 0109: failed the under-lock re-check
          end if;
        end loop;
      end if;
      if v_ring > v_ring0 then
        perform _dispatch_log(p_order_id, 'ring_expanded', jsonb_build_object('from', v_ring0, 'to', v_ring));
      end if;
    end if;

    exit when v_found;
    -- Candidates existed but were all locked/taken this instant: do not burn the cycle, report 'busy'
    -- (0109) and retry shortly. After v_busy_max busy results in a row (busy_count) this is skipped:
    -- the escalated pass (v_limit 25) falls through to the next cycle / the no-candidates path.
    if v_seen and coalesce(v_od.busy_count, 0) < v_busy_max then
      v_busy := true;
      exit;
    end if;
    -- Nothing left this cycle. Restart only if riders were actually asked in it
    -- (otherwise a restart changes nothing), and only once per call.
    exit when v_renewed or v_cycle_offers = 0;
    v_renew := true;
    v_renewed := true;
  end loop;

  -- 0109: BUSY. Candidates existed but none could be asked right now (locked by another transaction,
  -- or no longer eligible under the lock). Not "no candidates": no funnel row, no vendor notice,
  -- no needs_attention, ring and cycle untouched. Retry in 5 s (one tick).
  if v_busy then
    update order_dispatch
    set busy_count = busy_count + 1,
        state = case when state = 'needs_attention' then state else 'searching' end,
        next_check_at = now() + interval '5 seconds'
    where order_id = p_order_id returning * into v_od;
    perform _dispatch_log(p_order_id, 'dispatch_busy',
      jsonb_build_object('trigger', p_trigger, 'busy_count', v_od.busy_count, 'locked', v_locked,
                         'rejected', v_rejected, 'ring', v_ring, 'stage', v_stage, 'limit', v_limit));
    return jsonb_build_object('outcome', 'busy', 'offer_id', null, 'rider_id', null,
      'cycle_no', v_od.cycle_no, 'attempt_no', v_od.attempt_no, 'ring', v_ring, 'stage', v_stage,
      'radius_m', v_radius, 'tier', v_tier, 'candidates_evaluated', v_n, 'in_range_riders', null,
      'reason', 'riders_busy', 'busy_count', v_od.busy_count, 'offers_expired', v_expired);
  end if;

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
        error_count = 0, last_error = null, busy_count = 0,
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
      error_count = 0, last_error = null, busy_count = 0
  where order_id = p_order_id;
  if v_attn is not null and v_od.needs_attention_since is null then
    perform _dispatch_log(p_order_id, 'needs_attention', jsonb_build_object('reason', v_attn));
  end if;

  return jsonb_build_object('outcome', 'no_candidates', 'offer_id', null, 'rider_id', null,
    'cycle_no', v_od.cycle_no, 'attempt_no', v_od.attempt_no, 'ring', v_ring, 'stage', 'beyond_rings',
    'radius_m', v_radius, 'tier', v_tier, 'candidates_evaluated', 0, 'in_range_riders', c.in_range_riders,
    'reason', 'none_available', 'offers_expired', v_expired);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Legacy wrappers: small batches (they hold every order lock until their one transaction ends)
-- ---------------------------------------------------------------------------

create or replace function public.sweep_dispatch_offers()
 returns table(offers_expired integer, offers_created integer, orders_cancelled integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_res jsonb;
begin
  if coalesce(auth.role(), current_setting('role', true)) is distinct from 'service_role' then
    raise exception 'sweep_dispatch_offers: requires the service-role key';
  end if;
  -- 0109: 10, not 100. TESTS / MANUAL USE ONLY, never schedule it: all orders are processed in ONE
  -- transaction, so their row locks are held to the end. dispatch_tick() commits per order.
  v_res := _dispatch_tick_run(10, 'sweep');
  return query select (v_res ->> 'offers_expired')::integer, (v_res ->> 'offers_created')::integer,
                      (v_res ->> 'orders_cancelled')::integer;
end;
$function$;

create or replace function public.dispatch_orders_nearing_prep_completion()
 returns table(offers_created integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_created integer := 0;
  v_id      uuid;
begin
  if coalesce(auth.role(), current_setting('role', true)) is distinct from 'service_role' then
    raise exception 'dispatch_orders_nearing_prep_completion: requires the service-role key';
  end if;

  -- 0109: limit 10 (was 100); same single-transaction caveat as sweep_dispatch_offers (tests / manual use only).
  for v_id in
    select o.id
    from orders o join order_dispatch od on od.order_id = o.id
    where o.status in ('accepted', 'preparing') and o.rider_id is null and o.delivery_by = 'rider'
      and od.state = 'scheduled' and od.start_at <= now()
    order by od.start_at
    limit 10
  loop
    if _dispatch_tick_order(v_id, 'early_dispatch') ->> 'outcome' = 'offered' then
      v_created := v_created + 1;
    end if;
  end loop;

  return query select v_created;
end;
$function$;

comment on function public._dispatch_tick_run(integer, text) is
  '0109: same loop as dispatch_tick() but in ONE transaction (per-order subtransactions, no COMMIT), so it holds every processed order''s locks until it returns. For tests, PostgREST and manual use with a small p_limit; never schedule it. The scheduled worker is the procedure dispatch_tick(), which commits after each order.';

-- ---------------------------------------------------------------------------
-- 4. Hygiene
-- ---------------------------------------------------------------------------

alter function public._dispatch_worker_caller_ok() set search_path = public;

revoke execute on function public.accept_dispatch_offer(uuid) from anon;
revoke execute on function public.decline_dispatch_offer(uuid) from anon;
revoke execute on function public.dispatch_order_to_nearby_riders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Rate limit: documented as best-effort
-- ---------------------------------------------------------------------------

comment on function public._dispatch_rate_check(uuid) is
  'Rolling 30-per-minute limit on offer responses per rider (P0429). BEST EFFORT: the log row is written in the caller''s transaction, so a call that RAISES (legacy accept/decline losing a race, any validation error) rolls its row back and is never counted; only calls that return are. It bounds a rider''s successful/idempotent traffic, not a flood of failing calls. Making failures count would need an autonomous transaction (dblink), deliberately not introduced.';

-- ---------------------------------------------------------------------------
-- 6. Dead-tick health for the admin page
-- ---------------------------------------------------------------------------

-- Read-only, service_role only (the admin page calls it through the admin client after its own admin
-- check). Never raises because pg_cron / vault are missing or unreadable: the cron and vault tables are
-- touched only through dynamic SQL behind to_regclass and an exception guard. Vault: NAMES only,
-- vault.secrets, never decrypted values.
--   healthy = the dispatch-tick job exists and is active, its last SUCCESSFUL run ended <= 30 s ago
--             (the tick runs every 5 s), no live order is overdue by more than 60 s, and both
--             worker secrets exist.
--   orders_overdue / oldest_overdue_next_check_seconds use the same predicate: a row in a live state
--   (not assigned/stopped) whose next_check_at is already past.
create or replace function public.admin_dispatch_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller   text := coalesce(auth.role(), current_setting('role', true));
  v_cron     boolean := false;
  v_jobid    bigint;
  v_job      boolean := false;
  v_last_at  timestamptz;
  v_last_st  text;
  v_last_ok  timestamptz;
  v_tick_s   integer;
  v_oldest   integer;
  v_overdue  integer := 0;
  v_secrets  boolean := false;
  v_queue    integer;
  v_problems text[] := '{}';
  v_healthy  boolean;
begin
  if v_caller is distinct from 'service_role' then
    raise exception 'admin_dispatch_health: requires the service-role key' using errcode = 'insufficient_privilege';
  end if;

  -- pg_cron
  begin
    if to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null then
      execute 'select jobid from cron.job where jobname = $1 and active order by jobid limit 1' into v_jobid using 'dispatch-tick';
      v_cron := true;
      v_job := v_jobid is not null;
      if v_job then
        execute 'select start_time, status from cron.job_run_details where jobid = $1 order by runid desc limit 1'
          into v_last_at, v_last_st using v_jobid;
        execute 'select end_time from cron.job_run_details where jobid = $1 and status = ''succeeded'' order by runid desc limit 1'
          into v_last_ok using v_jobid;
      end if;
    end if;
  exception when others then
    v_cron := false; v_job := false; v_last_at := null; v_last_st := null; v_last_ok := null;
  end;
  if v_last_ok is not null then
    v_tick_s := greatest(0, floor(extract(epoch from now() - v_last_ok))::integer);
  end if;

  -- Orders whose next dispatch check is overdue
  select floor(max(extract(epoch from now() - od.next_check_at)))::integer, count(*)::integer
    into v_oldest, v_overdue
  from order_dispatch od
  where od.state not in ('assigned', 'stopped') and od.next_check_at < now();

  -- Worker secrets (names only)
  begin
    if to_regclass('vault.secrets') is not null then
      execute 'select count(distinct name) = 2 from vault.secrets where name in (''message_worker_function_url'', ''message_worker_secret'')'
        into v_secrets;
    end if;
  exception when others then
    v_secrets := false;
  end;

  select floor(extract(epoch from now() - min(created_at)))::integer into v_queue
  from message_outbox where status = 'queued';

  if not v_cron then
    v_problems := v_problems || 'The scheduler (pg_cron) is not enabled'::text;
  elsif not v_job then
    v_problems := v_problems || 'The dispatch timer is not scheduled (the dispatch-tick job is missing or paused)'::text;
  elsif v_tick_s is null then
    v_problems := v_problems || 'The dispatch timer has never run successfully'::text;
  elsif v_tick_s > 30 then
    v_problems := v_problems || case
      when v_tick_s < 120 then format('The dispatch timer has not run for %s seconds', v_tick_s)
      else format('The dispatch timer has not run for %s minutes', v_tick_s / 60)
    end;
  end if;
  if coalesce(v_oldest, 0) > 60 then
    v_problems := v_problems || format('Rider search is running late: %s order(s) are waiting for their next check, the oldest %s seconds', v_overdue, v_oldest);
  end if;
  if not v_secrets then
    v_problems := v_problems || 'Rider notifications are not configured: the worker secrets are missing'::text;
  end if;

  v_healthy := v_job and v_tick_s is not null and v_tick_s <= 30 and coalesce(v_oldest, 0) <= 60 and v_secrets;

  return jsonb_build_object(
    'cron_available', v_cron,
    'tick_job_present', v_job,
    'tick_last_run_at', v_last_at,
    'tick_last_status', v_last_st,
    'tick_overdue_seconds', v_tick_s,
    'oldest_overdue_next_check_seconds', v_oldest,
    'orders_overdue', v_overdue,
    'worker_secrets_present', v_secrets,
    'queued_push_oldest_seconds', v_queue,
    'healthy', v_healthy,
    'problems', to_jsonb(v_problems));
end;
$$;
revoke all on function public.admin_dispatch_health() from public, anon, authenticated;
grant execute on function public.admin_dispatch_health() to service_role;
comment on function public.admin_dispatch_health() is
  '0109: dispatch timer health for /admin: pg_cron job dispatch-tick last success, overdue orders, worker secrets (names only), oldest queued outbox row. Read-only, service_role only, never raises for a missing cron/vault schema. healthy = job active and last success <= 30 s ago and no live order overdue > 60 s and both secrets present.';

-- ---------------------------------------------------------------------------
-- 7. One-off: re-plan orders the 0100 backfill left "searching" with no predicted start
-- ---------------------------------------------------------------------------

-- 0100 adopted every in-flight rider-delivery order as state 'searching', next_check_at = now(), no
-- start_at, so after deploy every accepted/preparing order with no rider and no offer would be
-- dispatched immediately instead of at its predicted start. Give those (and only those: no offer ever
-- made, no dispatch started) their predictive start now. Idempotent; a failing row is skipped.
create or replace function public._dispatch_reschedule_unstarted()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r   record;
  v_o orders;
  s   record;
  n   integer := 0;
begin
  for r in
    select od.order_id, od.expected_ready_at
    from order_dispatch od join orders o on o.id = od.order_id
    where od.state = 'searching' and od.start_at is null and od.dispatch_started_at is null and od.attempt_no = 0
      and o.status in ('accepted', 'preparing') and o.rider_id is null and o.delivery_by = 'rider'
      and not exists (select 1 from dispatch_offers d where d.order_id = od.order_id)
    order by od.order_id
  loop
    begin
      select * into v_o from orders where id = r.order_id;
      select * into s from _dispatch_start_calc(v_o, r.expected_ready_at);
      update order_dispatch
      set state = 'scheduled', start_at = s.start_at, start_basis = s.basis,
          next_check_at = least(s.start_at, now() + interval '60 seconds')
      where order_id = r.order_id;
      perform _dispatch_log(r.order_id, 'start_recomputed', jsonb_build_object('reason', 'backfill_0109', 'new', s.start_at));
      n := n + 1;
    exception when others then
      raise warning '_dispatch_reschedule_unstarted: order % skipped (%)', r.order_id, sqlstate;
    end;
  end loop;
  return n;
end;
$$;
revoke all on function public._dispatch_reschedule_unstarted() from public, anon, authenticated, service_role;

select public._dispatch_reschedule_unstarted();
