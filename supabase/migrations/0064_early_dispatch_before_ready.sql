-- KiaKia - riders currently only find out about a delivery once the vendor
-- marks it ready_for_pickup (dispatch_order_to_nearby_riders(), 0019/0023) -
-- meaning the rider's own trip to the vendor only starts after the food is
-- already sitting there waiting. Product decision: notify riders earlier,
-- timed to the vendor's own estimated prep completion (vendors.avg_prep_mins,
-- 0003_catalog.sql), not the literal instant the vendor accepts - dispatching
-- at accept, before any prep has happened, would routinely send a rider to
-- stand around a vendor unpaid for however long prep takes. See this
-- migration's own EARLY_DISPATCH_LEAD_MINUTES constant below for the exact
-- timing rule.
--
-- Three pieces, together:
--
--   1. dispatch_orders_nearing_prep_completion() - a new sweep, sibling to
--      sweep_dispatch_offers() (0055) rather than folded into it: distinct
--      responsibility (accepted/preparing orders approaching their prep
--      deadline, not ready_for_pickup orders whose FIRST offer round already
--      played out), distinct query shape, kept separate so each sweep stays
--      readable on its own. Reuses the exact same rider-matching filters
--      dispatch_order_to_nearby_riders() (0023) already established:
--      is_online, kyc_status = 'approved', current_location set,
--      5km radius, nearest 10.
--
--   2. accept_dispatch_offer() (last defined 0044) - relaxed to also accept
--      while status is 'accepted' or 'preparing', not only 'ready_for_pickup'.
--      An early accept claims rider_id (and computes rider_fee_kobo exactly
--      as today, from the rider's own live location) but deliberately does
--      NOT touch orders.status or assigned_at yet - see task 3 for why, and
--      see this task's own inline comments for the full reasoning. The
--      existing ready_for_pickup path is completely unchanged; every line of
--      it is reproduced byte-for-byte below except for the new early-accept
--      branch placed ahead of it.
--
--   3. dispatch_order_to_nearby_riders() (last defined 0023) - gains a guard
--      at its very top: if new.rider_id is already set when an order reaches
--      ready_for_pickup (meaning some rider pre-committed early), skip
--      dispatching fresh offers entirely and cascade straight to
--      rider_assigned instead, logged as a system-actor order_events row.
--      This is what keeps the customer's tracking timeline
--      (orders/[id]/tracking/page.tsx's buildSteps(), apps/web) visually
--      correct: ready_at and assigned_at still land in the same relative
--      order they always have, even though the rider actually committed
--      earlier, behind the scenes, via task 2's new path. Without this, an
--      early accept would either have to fabricate assigned_at ahead of
--      ready_at (a step marked done before an earlier one, rendering as
--      visibly out of sequence) or the rider would end up double-offered
--      when ready_for_pickup naturally fires - this guard is what avoids
--      both.
--
-- Operational requirement, stated plainly rather than left implicit: this
-- degrades to today's exact behavior (dispatch only at ready_for_pickup)
-- unless dispatch_orders_nearing_prep_completion() actually runs on a
-- schedule. Same best-effort pg_cron attempt as 0057_rider_review_round_two.sql
-- made for sweep_dispatch_offers() - see that migration's own header for why
-- `create extension pg_cron` can fail outright depending on whether the
-- running Postgres server was started with it in shared_preload_libraries,
-- and for the exact SET ROLE requirement a plain pg_cron job needs. If it is
-- not scheduled here, sweep_dispatch_offers()'s own comment already
-- documents the external-scheduler alternative - the same one applies to
-- this new function.

-- ---------------------------------------------------------------------------
-- Task 1 - dispatch_orders_nearing_prep_completion()
-- ---------------------------------------------------------------------------

create or replace function dispatch_orders_nearing_prep_completion()
returns table (
  offers_created  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role       text := coalesce(auth.role(), current_setting('role', true));
  v_created_count     integer := 0;
  v_inserted          integer;
  v_candidate         record;
  v_order             orders;
  v_vendor_location   geography(point, 4326);
  v_avg_prep_mins     integer;
  -- How many minutes before the vendor's own estimated prep completion to
  -- start offering the order to nearby riders - long enough for a rider to
  -- notice the offer, accept it, and travel to the vendor, short enough that
  -- prep is genuinely close to done when they arrive rather than the rider
  -- waiting around. A placeholder, same posture as SERVICE_FEE_BPS
  -- (packages/domain/src/delivery.ts) and rider_base_fee_kobo/
  -- rider_per_km_fee_kobo (0044) - no real measured rider-travel-time
  -- decision exists yet, flagged here rather than silently assumed.
  c_lead_minutes constant integer := 8;
begin
  if v_caller_role is distinct from 'service_role' then
    raise exception 'dispatch_orders_nearing_prep_completion: requires the service-role key';
  end if;

  for v_candidate in
    select o.id as order_id, o.vendor_id, o.accepted_at
    from orders o
    join vendors v on v.id = o.vendor_id
    where o.status in ('accepted', 'preparing')
      and o.rider_id is null
      and o.accepted_at is not null
      and now() >= o.accepted_at + make_interval(mins => greatest(v.avg_prep_mins - 8, 0))
      and not exists (
        select 1 from dispatch_offers d where d.order_id = o.id and d.status = 'offered'
      )
  loop
    select * into v_order from orders where id = v_candidate.order_id for update skip locked;
    if not found then
      -- Locked by a concurrent transaction (a vendor advancing this exact
      -- order's status, or a rider racing an early accept on it) - leave it
      -- for the next sweep run rather than blocking on it. Same posture as
      -- sweep_dispatch_offers() (0055).
      continue;
    end if;

    -- Re-verify under the lock: the cursor above is a snapshot that could be
    -- stale by the time this specific order's lock was actually acquired.
    if v_order.status not in ('accepted', 'preparing') or v_order.rider_id is not null then
      continue;
    end if;

    select location into v_vendor_location from vendors where id = v_order.vendor_id;
    if v_vendor_location is null then
      -- Same silent-skip posture dispatch_order_to_nearby_riders() (0019/
      -- 0023) and sweep_dispatch_offers() (0055) already take for a
      -- location-less vendor.
      continue;
    end if;

    begin
      insert into dispatch_offers (order_id, rider_id)
      select v_order.id, r.user_id
      from riders r
      where r.is_online
        and r.kyc_status = 'approved'
        and r.current_location is not null
        and st_dwithin(r.current_location, v_vendor_location, 5000) -- 5km radius, same as 0019/0023
      order by st_distance(r.current_location, v_vendor_location) asc
      limit 10
      on conflict (order_id, rider_id) do nothing;

      get diagnostics v_inserted = row_count;
      v_created_count := v_created_count + v_inserted;
    exception when others then
      -- A failure offering ONE order must never abort the sweep for every
      -- other order still waiting on it - same posture as
      -- dispatch_order_to_nearby_riders() (0023) and sweep_dispatch_offers()
      -- (0055).
      raise warning 'dispatch_orders_nearing_prep_completion: failed to create dispatch offers for order % - %', v_order.id, sqlerrm;
    end;
  end loop;

  return query select v_created_count;
end;
$$;

comment on function dispatch_orders_nearing_prep_completion() is
  'Early-dispatch sweep: offers an order to nearby riders once the vendor''s own estimated prep time (avg_prep_mins) is within c_lead_minutes (8, a placeholder - see this function''s own inline comment) of being done, rather than waiting for ready_for_pickup. Applies the same is_online/kyc_status/current_location/5km-radius/nearest-10 filters dispatch_order_to_nearby_riders() (0019/0023) applies. service_role only. NOT scheduled by this migration by default - see 0064_early_dispatch_before_ready.sql''s own header for the pg_cron attempt below and the operational requirement if that attempt does not succeed on this server.';

revoke execute on function dispatch_orders_nearing_prep_completion() from public, authenticated;
grant execute on function dispatch_orders_nearing_prep_completion() to service_role;

-- ---------------------------------------------------------------------------
-- Task 2 - accept_dispatch_offer(): relaxed status gate, new early-accept
-- branch. The ready_for_pickup path below is 0044's own body, unchanged.
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
  select current_location into v_rider_location from riders where user_id = auth.uid();
  if v_rider_location is null then
    raise exception 'accept_dispatch_offer: rider has no current_location set, cannot compute rider fee';
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
$$;

comment on function accept_dispatch_offer(uuid) is
  'The only way a dispatch offer becomes an assignment, and the only writer of orders.rider_fee_kobo/rider_pickup_distance_m. As of 0064, accepts while the order is ''accepted'' or ''preparing'' (an early accept - claims rider_id and freezes rider_fee_kobo, leaves status/assigned_at untouched, see this migration''s header) in addition to the original ''ready_for_pickup'' path (status moves straight to rider_assigned, unchanged from 0044). Gated by: an ''offered'' row for the caller that has not yet passed expires_at (0028), rider_id-null on the order, and kyc_status = ''approved'' on the caller''s own live riders row (0023). rider_fee_kobo is computed identically on both paths - the rider''s own current_location -> vendor distance plus the order''s existing vendor->customer distance_m, against service_areas.rider_base_fee_kobo/rider_per_km_fee_kobo (0044).';

revoke execute on function accept_dispatch_offer(uuid) from public;
grant execute on function accept_dispatch_offer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Task 3 - dispatch_order_to_nearby_riders(): cascade guard for a
-- pre-committed rider. The rest of this function is 0023's own body,
-- unchanged.
-- ---------------------------------------------------------------------------

create or replace function dispatch_order_to_nearby_riders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor_location geography(point, 4326);
begin
  -- NEW (0064): a rider already claimed this order via an early accept
  -- (task 2's new branch in accept_dispatch_offer()) before the vendor
  -- ever reached ready_for_pickup. Don't dispatch fresh offers - that
  -- rider is already committed - cascade straight to rider_assigned
  -- instead, logged as a system-actor transition since no rider action is
  -- happening at this exact moment (the food becoming ready is what fired
  -- this trigger, not anything the rider did). This is what keeps
  -- ready_at/assigned_at landing in the same relative order the customer
  -- tracking timeline (orders/[id]/tracking/page.tsx's buildSteps())
  -- already assumes, even though the rider actually committed earlier.
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

  select location into v_vendor_location from vendors where id = new.vendor_id;

  if v_vendor_location is null then
    return new;
  end if;

  begin
    insert into dispatch_offers (order_id, rider_id)
    select new.id, r.user_id
    from riders r
    where r.is_online
      and r.kyc_status = 'approved'
      and r.current_location is not null
      and st_dwithin(r.current_location, v_vendor_location, 5000) -- 5km radius
    order by st_distance(r.current_location, v_vendor_location) asc
    limit 10
    on conflict (order_id, rider_id) do nothing;
  exception when others then
    raise warning 'dispatch_order_to_nearby_riders: failed to create dispatch offers for order % - %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function dispatch_order_to_nearby_riders() is
  'AFTER UPDATE OF status trigger on orders: when an order becomes ready_for_pickup, either cascades straight to rider_assigned if a rider already pre-committed via an early accept (0064 - new.rider_id is not null), or offers it to the 10 nearest online, KYC-approved riders within 5km of the vendor''s location, same as always. SECURITY DEFINER because riders/dispatch_offers/orders writes must bypass RLS. The offer-insert itself is wrapped in an exception handler so a failure there can never abort the ready_for_pickup transition that fired this trigger - see 0023_rider_dispatch_kyc_hardening.sql.';

-- The trigger itself (created in 0019) is unchanged.

-- ---------------------------------------------------------------------------
-- Best-effort pg_cron scheduling for dispatch_orders_nearing_prep_completion(),
-- same posture as 0057_rider_review_round_two.sql's own attempt for
-- sweep_dispatch_offers() - see that migration's header for the full
-- reasoning on why `create extension pg_cron` can fail outright, and why a
-- plain pg_cron job needs an explicit SET ROLE to run as service_role rather
-- than the postgres superuser it defaults to.
-- ---------------------------------------------------------------------------

do $$
declare
  v_pg_cron_enabled boolean := false;
begin
  begin
    create extension if not exists pg_cron;
    v_pg_cron_enabled := true;
  exception when others then
    raise notice 'dispatch_orders_nearing_prep_completion: pg_cron extension could not be enabled (%). This is expected if the running Postgres server was not started with pg_cron in shared_preload_libraries. The early-dispatch sweep is NOT scheduled - see 0064_early_dispatch_before_ready.sql''s own header for the operational requirement and the external-scheduler alternative.', sqlerrm;
  end;

  if v_pg_cron_enabled then
    begin
      perform cron.schedule(
        'dispatch-orders-nearing-prep-completion',
        '* * * * *', -- every minute; prep windows are minutes long, sub-minute precision is not needed
        $cron$
          set local role service_role;
          select dispatch_orders_nearing_prep_completion();
        $cron$
      );
    exception when others then
      raise notice 'dispatch_orders_nearing_prep_completion: pg_cron extension enabled but cron.schedule() failed (%). The early-dispatch sweep is NOT scheduled - see this migration''s header for the external-scheduler alternative.', sqlerrm;
    end;
  end if;
end;
$$;
