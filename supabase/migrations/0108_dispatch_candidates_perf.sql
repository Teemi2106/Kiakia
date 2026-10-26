-- 0108: dispatch candidate discovery performance (D6/D7).
--
-- Found by supabase/tests/h3/bench-discovery.sql (see "Benchmark (H3 vs GiST)" in
-- docs/dispatch-design.md): the H3 branch of _dispatch_candidates joined the disk ranges as the
-- OUTER side of a nested loop over a Seq Scan of riders whose filter ran the plpgsql helper
-- _dispatch_rider_available (~28 us) on EVERY online rider, so one lookup cost 0.2-2.5 s at
-- 5k-50k riders, riders_h3_cell_idx was never used, and _dispatch_advance re-ran that for every
-- ring step (4-33 s when the rings were empty and it fell back to KNN).
--
-- What changes (results are identical; semantics unchanged):
--  1. New _dispatch_scan(order, from_ring, max_ring, radius, cycle, limit): one
--     scan per advance step instead of one query per ring; the H3 disk is generated lazily (the
--     small disk first, the full max-ring disk once, only if that was empty). The disk ranges are probed one by
--     one (LATERAL ... where h3_cell between lo and hi) so riders_h3_cell_idx is used, and
--     availability / exclusion / fee are plain inlinable SQL predicates (profile join,
--     busy anti-join on orders(rider_id), two anti-joins on dispatch_offers). It walks the rings
--     outwards and returns the candidates of the FIRST ring >= from_ring that has a survivor
--     (disk <= that ring, exactly what _dispatch_candidates(ring) returned), tagged scan_ring.
--     With from_ring null it is the KNN fallback (ORDER BY current_location <-> vendor, same
--     predicates).
--  2. Ranking: the ETA is monotonic in distance (metres x factor / speed + 60), so order by
--     (eta, distance, uid) == order by (distance, uid). This holds ONLY because
--     _estimate_travel_seconds is monotonic in distance for a fixed vendor/area. If a routing
--     provider (the D7 seam) is ever added, the scan must rank by ETA instead. The scan therefore ranks by distance in
--     SQL and calls _estimate_travel_seconds only for the (at most p_limit) rows it returns,
--     never per scanned rider.
--  3. _dispatch_candidates keeps its signature and return shape and is now a thin wrapper
--     (one ring, or the KNN fallback when the ring is null).
--  4. _dispatch_advance asks _dispatch_scan for the first non-empty ring instead of calling
--     _dispatch_candidates once per ring step: empty rings are skipped inside one call, v_ring
--     is set to the ring actually used (or max ring when nothing was found), so offer.ring and
--     the ring_expanded event are exactly as before. Everything else, including the 0107 rider
--     lock and the under-lock re-check, is the 0107 body.
--  5. _dispatch_start_calc uses one _dispatch_scan instead of a ring loop (same candidates).
--
-- _dispatch_rider_available / _dispatch_rider_excluded stay the single definitions used for the
-- under-lock re-check; the inline predicates must stay logically identical to them. The parity
-- test in supabase/tests/dispatch_engine.sql compares the scan with the helpers on a mixed
-- fixture so the two cannot drift silently.
--
-- No schema or index change: the needed indexes already exist (riders_h3_cell_idx,
-- riders_current_location_gix, orders_rider_id_idx, dispatch_offers_rider_live_idx,
-- dispatch_offers_rider_id_idx). Internal functions only: packages/db generated types unaffected.

create or replace function _dispatch_scan(p_order_id uuid, p_from_ring integer, p_max_ring integer,
                                          p_radius_m integer, p_cycle_no integer, p_limit integer default 1)
returns table(rider_id uuid, ring integer, distance_m integer, eta_seconds integer, fee_kobo bigint, stage text, scan_ring integer)
language plpgsql stable security definer set search_path = public as $fn$
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
  v_age     integer := _platform_setting_int('dispatch_location_max_age_seconds')::integer;
  v_ks      integer[];
  v_los     bigint[];
  v_his     bigint[];
  v_klo     integer := 0;
  v_max     integer;
  v_disk    integer;
  v_r       integer;
  v_any     boolean;
  x         record;
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

  if p_from_ring is null then
    -- KNN fallback ("beyond_rings"): nearest eligible riders, GiST-ordered, same predicates.
    -- (The limit is applied in distance order; the final order is ETA, distance, rider like 0101.)
    for x in
      select p.uid, p.d, p.loc
      from (
        select r.user_id as uid, st_distance(r.current_location, v_vloc) as d, r.current_location as loc
        from riders r join profiles pr on pr.id = r.user_id
        where r.is_online and r.kyc_status = 'approved' and r.current_location is not null
          and r.last_ping_at >= now() - make_interval(secs => v_age)
          and pr.status = 'active'
          and not exists (select 1 from orders o where o.rider_id = r.user_id
                          and o.status in ('accepted', 'preparing', 'rider_assigned', 'picked_up', 'in_transit', 'arrived'))
          and not exists (select 1 from dispatch_offers d where d.rider_id = r.user_id and d.order_id = p_order_id
                          and (d.status in ('declined', 'revoked', 'accepted', 'offered') or d.cycle_no = p_cycle_no))
          and not exists (select 1 from dispatch_offers d where d.rider_id = r.user_id and d.order_id <> p_order_id
                          and d.status = 'offered' and d.expires_at > now())
          and (p_radius_m is null or st_dwithin(r.current_location, v_vloc, p_radius_m))
          and v_base + v_per_km * ceil((st_distance(r.current_location, v_vloc) + v_dist) / 1000.0)::bigint <= v_max_fee
        order by r.current_location <-> v_vloc
        limit v_limit
      ) p
      order by p.d, p.uid
    loop
      rider_id := x.uid; ring := null; distance_m := round(x.d)::integer;
      eta_seconds := _estimate_travel_seconds(x.loc, v_vloc, v_area_id);
      fee_kobo := v_base + v_per_km * ceil((x.d + v_dist) / 1000.0)::bigint;
      stage := 'beyond_rings'; scan_ring := null;
      return next;
    end loop;
    return;
  end if;

  v_cell := h3_latlng_to_cell(st_y(v_vloc::geometry), st_x(v_vloc::geometry),
                              _platform_setting_int('dispatch_h3_resolution')::integer);
  v_max := greatest(coalesce(p_max_ring, p_from_ring), p_from_ring);

  -- Ring by ring, outwards. The first step covers the whole disk <= from_ring; later steps only
  -- the new ring (the smaller disks were just found empty). The disk is generated lazily: the
  -- common case (a survivor in the first ring) pays only for the small disk; when it is empty
  -- the full disk is generated ONCE and the remaining rings are walked from it.
  for v_r in p_from_ring..v_max loop
    if v_disk is null or (v_r > v_disk and v_disk < v_max) then
      v_disk := case when v_r = p_from_ring then p_from_ring else v_max end;
      select coalesce(array_agg(q.k order by q.k, q.lo), '{}'), coalesce(array_agg(q.lo order by q.k, q.lo), '{}'),
             coalesce(array_agg(q.hi order by q.k, q.lo), '{}')
        into v_ks, v_los, v_his
      from (select d.k, g.lo, g.hi
            from h3_grid_disk_distances(v_cell, v_disk) d      -- strict: no rows when the cell is null
            cross join lateral h3_cell_to_descendant_range(d.cell, 9) g) q;
    end if;
    v_any := false;
    -- Cheap column predicates + distance first, sorted nearest first; the profile join and the
    -- three anti-joins are then evaluated lazily in that order and stop after v_limit rows, so
    -- they run on a handful of riders instead of every rider in the disk.
    for x in
      with cheap as materialized (
        select y.uid, y.k, y.d, y.loc
        from (select u.k, u.lo, u.hi from unnest(v_ks, v_los, v_his) as u(k, lo, hi)
              where u.k between v_klo and v_r) rg
        cross join lateral (
          select r.user_id as uid, rg.k as k, st_distance(r.current_location, v_vloc) as d, r.current_location as loc
          from riders r
          where r.h3_cell between rg.lo and rg.hi
            and r.is_online and r.kyc_status = 'approved' and r.current_location is not null
            and r.last_ping_at >= now() - make_interval(secs => v_age)
          offset 0                            -- fence: forces one index probe per range, never a flattened join
        ) y
        where (p_radius_m is null or st_dwithin(y.loc, v_vloc, p_radius_m))
          and v_base + v_per_km * ceil((y.d + v_dist) / 1000.0)::bigint <= v_max_fee
        order by y.d, y.uid
      )
      select t.uid, t.k, t.d, t.loc
      from (
      select c.uid, c.k, c.d, c.loc
      from cheap c
      where exists (select 1 from profiles pr where pr.id = c.uid and pr.status = 'active')
        and not exists (select 1 from orders o where o.rider_id = c.uid
                        and o.status in ('accepted', 'preparing', 'rider_assigned', 'picked_up', 'in_transit', 'arrived'))
        and not exists (select 1 from dispatch_offers d where d.rider_id = c.uid and d.order_id = p_order_id
                        and (d.status in ('declined', 'revoked', 'accepted', 'offered') or d.cycle_no = p_cycle_no))
        and not exists (select 1 from dispatch_offers d where d.rider_id = c.uid and d.order_id <> p_order_id
                        and d.status = 'offered' and d.expires_at > now())
      limit v_limit                           -- lazy top-N: stops after v_limit survivors in CTE (d, uid) order
      ) t
      order by t.d, t.uid                     -- explicit final ranking (<= v_limit rows); never rely on scan order
    loop
      v_any := true;
      rider_id := x.uid; ring := x.k; distance_m := round(x.d)::integer;
      eta_seconds := _estimate_travel_seconds(x.loc, v_vloc, v_area_id);
      fee_kobo := v_base + v_per_km * ceil((x.d + v_dist) / 1000.0)::bigint;
      stage := 'rings'; scan_ring := v_r;
      return next;
    end loop;
    if v_any then
      return;                              -- this ring had survivors: stop
    end if;
    v_klo := v_r + 1;
  end loop;
end;
$fn$;

-- Thin wrapper with the 0101 signature. p_ring null = KNN fallback. The scan already returns
-- rows in (ETA, distance, rider) order.
create or replace function _dispatch_candidates(p_order_id uuid, p_ring integer, p_radius_m integer, p_cycle_no integer, p_limit integer default 1)
returns table(rider_id uuid, ring integer, distance_m integer, eta_seconds integer, fee_kobo bigint, stage text)
language sql stable security definer set search_path = public as $fn$
  select s.rider_id, s.ring, s.distance_m, s.eta_seconds, s.fee_kobo, s.stage
  from _dispatch_scan(p_order_id, p_ring, p_ring, p_radius_m, p_cycle_no, p_limit) s
$fn$;

revoke all on function _dispatch_scan(uuid, integer, integer, integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function _dispatch_candidates(uuid, integer, integer, integer, integer) from public, anon, authenticated, service_role;

-- _dispatch_advance: the 0107 body with the ring loop calling _dispatch_scan (see header, point 4).
CREATE OR REPLACE FUNCTION public._dispatch_advance(p_order_id uuid, p_trigger text, p_force_widen boolean DEFAULT false)
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
        -- 0108: ONE scan returns the candidates of the first ring >= v_ring that
        -- has any survivor; empty rings are skipped inside it. scan_ring is the ring used.
        for c in select * from _dispatch_scan(p_order_id, v_ring, v_max_ring, v_radius, v_od.cycle_no, 5) loop
          v_ring := c.scan_ring;
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
$fn$;

-- _dispatch_start_calc: the 0104 body with one scan instead of a ring loop (point 5).
CREATE OR REPLACE FUNCTION public._dispatch_start_calc(p_order orders, p_expected_ready_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(start_at timestamp with time zone, basis jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
declare
  v_od       order_dispatch;
  v_accepted timestamptz := coalesce(p_order.accepted_at, p_order.created_at);
  v_ready    timestamptz;
  v_max      integer := _platform_setting_int('dispatch_h3_max_ring')::integer;
  v_ring     integer := least(_platform_setting_int('dispatch_h3_initial_ring')::integer, v_max);
  v_radius   integer := nullif(_platform_setting_int('dispatch_radius_m')::integer, 0);
  v_etas     integer[];
  v_travel   integer;
  v_tsrc     text;
  v_buf      integer;
  v_bsrc     text;
  v_st       dispatch_area_stats;
begin
  select * into v_od from order_dispatch where order_id = p_order.id;
  v_ready := coalesce(p_expected_ready_at, v_od.expected_ready_at,
                      v_accepted + make_interval(mins => (select avg_prep_mins from vendors where id = p_order.vendor_id)));

  -- The engine's own discovery: rings outwards from the first ring, then the KNN fallback.
  -- 0108: one scan finds the first non-empty ring instead of a per-ring loop.
  v_etas := array(select c.eta_seconds from _dispatch_scan(p_order.id, v_ring, v_max, v_radius, coalesce(v_od.cycle_no, 0), 3) c);
  if cardinality(v_etas) = 0 then
    v_etas := array(select c.eta_seconds from _dispatch_candidates(p_order.id, null, v_radius, coalesce(v_od.cycle_no, 0), 3) c);
  end if;
  if cardinality(v_etas) > 0 then
    select round(percentile_cont(0.5) within group (order by e))::integer into v_travel from unnest(v_etas) e;
    v_tsrc := 'candidates';
  else
    v_travel := _platform_setting_int('dispatch_default_travel_seconds')::integer;
    v_tsrc := 'default';
  end if;

  select * into v_st from dispatch_area_stats s where s.service_area_id = p_order.service_area_id and s.buffer_source = 'history';
  if found then
    v_buf := v_st.secure_buffer_s;
    v_bsrc := 'history';
  else
    v_buf := _platform_setting_int('dispatch_secure_buffer_seconds')::integer;
    v_bsrc := 'default';
  end if;
  v_buf := least(900, greatest(45, v_buf));

  return query select greatest(v_ready - make_interval(secs => v_travel + v_buf), v_accepted),
    jsonb_build_object('travel_s', v_travel, 'travel_source', v_tsrc, 'buffer_s', v_buf, 'buffer_source', v_bsrc,
                       'candidates_used', cardinality(v_etas), 'expected_ready_at', v_ready, 'computed_at', now());
end;
$fn$;
